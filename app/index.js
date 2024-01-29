"use strict";

const restify = require("restify");
const PNG = require("pngjs").PNG;
const DEFAULT_COLOR = [0, 0, 0, 0]; // RGBA
const ROBOTS_TXT = `# disallow all robots
User-agent: *
Disallow: /
`;

// Setup database
const db = require("better-sqlite3")("data/database.db");
db.pragma("journal_mode = WAL");

db.exec(`CREATE TABLE IF NOT EXISTS hits (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	date UNSIGNED BIGINT NOT NULL,
	category VARCHAR(32),
	ip_address VARCHAR(45) NOT NULL,
	width UNSIGNED SMALLINT NOT NULL,
	height UNSIGNED SMALLINT NOT NULL,
	color UNSIGNED BIGINT NOT NULL,
	metadata VARCHAR(255),
	user_agent VARCHAR(255) NOT NULL
);`);

db.exec(`CREATE INDEX IF NOT EXISTS hits_index ON hits (date, category, ip_address);`);

// Environment variables
const proxy = (process.env.BEHIND_PROXY === "true");
const admin_password = process.env.ADMIN_PASSWORD;

// Restify server
let server = restify.createServer();
server.use(restify.plugins.queryParser());

server.get("/", function(req, res, next) {
	res.noCache();

	res.send({
		"status": "ok",
		"message": null
	});

	return next();
});

server.get("/robots.txt", function(req, res, next) {
	
	res.sendRaw(200, ROBOTS_TXT, {
		"content-type": "text/plain"
	});

	return next();
});

server.get("/favicon.ico", function(req, res, next) {
	
	res.sendRaw(404, "", {
		"content-type": "image/x-icon"
	});

	return next();
});

server.get("/image/:category.png", function(req, res, next) {
	res.noCache();

	// Set up parameters
	let _red    = DEFAULT_COLOR[0];
	let _green  = DEFAULT_COLOR[1];
	let _blue   = DEFAULT_COLOR[2];
	let _alpha  = DEFAULT_COLOR[3];

	const category = (req.params.category == undefined ? null : req.params.category.slice(0, 32));
	const time = Math.round(req.time() / 1000);
	const user_agent = req.userAgent();
	const params = req.query;

	let ip_from_proxy = null;

	if (proxy) {
		let ips_from_proxy = req.headers['x-forwarded-for'].split(",") || ["0.0.0.0"];
		ip_from_proxy = ips_from_proxy[0].trim();
	}

	if (!category) {
		res.status(404);
		res.send({
			status: "error",
			message: "not found"
		});
		return next();
	}

	const ip_address = (proxy ? ip_from_proxy : req.socket.remoteAddress);
	const metadata = (params.m == undefined ? null : params.m.slice(0, 255));

	let width = Math.min(Math.max(parseInt(params.w == undefined ? 1 : params.w), 1), 512);
	let height = Math.min(Math.max(parseInt(params.h == undefined ? 1 : params.h), 1), 512);
	let color = parseInt(params.c == undefined ? 0 : params.c) >>> 0;

	if (color > 0) {
		_red   = (color >> 24) & 0xFF;
		_green = (color >> 16) & 0xFF;
		_blue  = (color >> 8) & 0xFF;
		_alpha = (color >> 0) & 0xFF;
	}

	// Log entry
	const stmt = db.prepare("INSERT INTO hits (date, category, ip_address, width, height, color, metadata, user_agent) VALUES (:date, :category, :ip_address, :width, :height, :color, :metadata, :user_agent)");
	stmt.run({
		date: time,
		category: category,
		ip_address: ip_address,
		width: width,
		height: height,
		color: color,
		metadata: metadata,
		user_agent: user_agent
	});

	console.log("ok", `image`, {
		date: time,
		category: category,
		ip_address: ip_address,
		width: width,
		height: height,
		color: color,
		metadata: metadata,
		user_agent: user_agent
	});


	// Generate image
	let image_options = {
		width: width,
		height: height,
		filterType: -1,
		inputHasAlpha: true
	};

	let image = new PNG(image_options);
	
	for (let x=0; x<image.width; x++) {
		for (let y=0; y<image.height; y++) {
			let idx = (image.width * y + x) << 2;
			image.data[idx+0] = _red;
			image.data[idx+1] = _green;
			image.data[idx+2] = _blue;
			image.data[idx+3] = _alpha;
		}
	}

	let buffer = PNG.sync.write(image.pack());

	res.setHeader("content-type", "image/png");
	res.send(buffer);
	return next();
});

server.get("/admin/:command", function(req, res, next) {
	res.noCache();

	const time = Math.round(req.time() / 1000);
	const path = req.getPath();
	const user_agent = req.userAgent();
	const query = req.query;
	const params = req.params;
	let ip_from_proxy = null;

	if (proxy) {
		let ips_from_proxy = req.headers['x-forwarded-for'].split(",") || ["0.0.0.0"];
		ip_from_proxy = ips_from_proxy[0].trim();
	}

	const ip_address = (proxy ? ip_from_proxy : req.socket.remoteAddress);

	console.log("ok", "admin", {
		date: time,
		ip_address: ip_address,
		path: path,
		user_agent: user_agent,
		command: params.command
	});



	// Authenticate
	if (admin_password == null || query.key !== admin_password) {
		res.status(403);
		res.send({
			"status": "error",
			"message": "unauthorized"
		});
		return next();
	}

	// Handle command
	if (params.command === "stats") {
		const limit = Math.min(Math.max(query.limit == undefined ? 50 : parseInt(query.limit), 1), 255);
		const page = Math.min(Math.max(query.page == undefined ? 1 : parseInt(query.page), 1), 100000);
		const before = Math.min(Math.max(query.before == undefined ? 0 : parseInt(query.before), 0), Number.MAX_VALUE);
		const after = Math.min(Math.max(query.after == undefined ? 0 : parseInt(query.after), 0), Number.MAX_VALUE);

		let filters = {};
		let results = [];

		// FIXME: messy
		if (query.category) {
			filters["category"] = query.category.trim().slice(0, 32);
			if (query.ip_address) {
				filters["ip_address"] = query.ip_address.trim().slice(0, 45);
				if (before > 0) {
					filters["before"] = before;
					if (after > 0) {
						filters["after"] = after;
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND ip_address = ? AND date <= ? AND date >= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["ip_address"], filters["before"], filters["after"], limit, (page-1) * limit);
					} else {
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND ip_address = ? AND date <= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["ip_address"], filters["before"], limit, (page-1) * limit);
					}
				} else {
					if (after > 0) {
						filters["after"] = after;
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND ip_address = ? AND date >= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["ip_address"], filters["after"], limit, (page-1) * limit);
					} else {
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND ip_address = ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["ip_address"], limit, (page-1) * limit);
					}
				}
			} else {
				if (before > 0) {
					filters["before"] = before;
					if (after > 0) {
						filters["after"] = after;
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND date <= ? AND date >= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["before"], filters["after"], limit, (page-1) * limit);
					} else {
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND date <= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["before"], limit, (page-1) * limit);
					}
				} else {
					if (after > 0) {
						filters["after"] = after;
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND date >= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["after"], limit, (page-1) * limit);
					} else {
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], limit, (page-1) * limit);
					}
				}
			}
		} else {
			if (query.ip_address) {
				filters["ip_address"] = query.ip_address.trim().slice(0, 45);
				if (before > 0) {
					filters["before"] = before;
					if (after > 0) {
						filters["after"] = after;
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND ip_address = ? AND date <= ? AND date >= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["ip_address"], filters["before"], filters["after"], limit, (page-1) * limit);
					} else {
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND ip_address = ? AND date <= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["ip_address"], filters["before"], limit, (page-1) * limit);
					}
				} else {
					if (after > 0) {
						filters["after"] = after;
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND ip_address = ? AND date >= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["ip_address"], filters["after"], limit, (page-1) * limit);
					} else {
						const stmt = db.prepare("SELECT * FROM hits WHERE category = ? AND ip_address = ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["category"], filters["ip_address"], limit, (page-1) * limit);
					}
				}
			} else {
				if (before > 0) {
					filters["before"] = before;
					if (after > 0) {
						filters["after"] = after;
						const stmt = db.prepare("SELECT * FROM hits WHERE date <= ? AND date >= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["before"], filters["after"], limit, (page-1) * limit);
					} else {
						const stmt = db.prepare("SELECT * FROM hits WHERE date <= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["before"], limit, (page-1) * limit);
					}
				} else {
					if (after > 0) {
						filters["after"] = after;
						const stmt = db.prepare("SELECT * FROM hits WHERE date >= ? ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(filters["after"], limit, (page-1) * limit);
					} else {
						const stmt = db.prepare("SELECT * FROM hits ORDER BY id DESC LIMIT ? OFFSET ?");
						results = stmt.all(limit, (page-1) * limit);
					}
				}
			}
		}


		let data = [];

		results.forEach((row) => {
			data.push({
				id: row.id,
				date: new Date(row.date * 1000).toISOString().slice(0,19).replace('T',' '),
				unix_time: row.date,
				category: row.category,
				ip_address: row.ip_address,
				user_agent: row.user_agent,
				metadata: row.metadata,
				image: {
					width: row.width,
					height: row.height,
					color: row.color >>> 0
				}
			})
		});

		res.send({
			status: "ok",
			filters: filters,
			results_count: results.length,
			results: data
		});
		return next();

	} else if (params.command === "color") {
		const red = Math.min(Math.max(query.red == undefined ? 0 : parseInt(query.red), 0), 255);
		const green = Math.min(Math.max(query.green == undefined ? 0 : parseInt(query.green), 0), 255);
		const blue = Math.min(Math.max(query.blue == undefined ? 0 : parseInt(query.blue), 0), 255);
		const alpha = Math.min(Math.max(query.alpha == undefined ? 0 : parseInt(query.alpha), 0), 255);

		const color = (red << 24) | (green << 16) | (blue << 8) | alpha;

		res.send({
			status: "ok",
			color: color >>> 0
		});
		return next();

	} else {
		res.status(404);
		res.send({
			status: "error",
			message: "not found"
		});
		return next();
	}

});

server.on("NotFound", function (req, res, err, cb) {
	res.send({
		status: "error",
		message: "not found"
	});
	return cb();
});



// Handle quit gracefully
function quit() {
	server.close();
	db.close();
	process.exit();
}

process.on('SIGINT', quit);
process.on('SIGQUIT', quit);
process.on('SIGTERM', quit);

console.log(`Listening for connections on port 8080`);
server.listen(8080);
