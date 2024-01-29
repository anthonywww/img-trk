# img-trk

Small image tracking API/Service, can be used in emails or webpages.

### 1. Build image
```sh
./docker-build.sh
```


### 2. Configuration

#### Configure hosts

Add the following to your hosts file:

```
127.0.0.1 img-trk.local
```

#### Environment Variables

| Name                    | Default Value | Description                                                   |
|-------------------------|---------------|---------------------------------------------------------------|
| `ADMIN_PASSWORD`        |               | Secure password for data access.                              |
| `BEHIND_PROXY`          | `false`       | Set to `true` to enable parsing `x-forward-for` headers.      |


### 3. Run

Run the container:

```sh
docker run --rm \
	-it \
	-e ADMIN_PASSWORD="test" \
	--name img-trk \
	-p 8080:8080/tcp \
	-v "$(pwd)/app/:/mnt/app/:ro" \
	-v "$(pwd)/data/:/mnt/data/" \
	img-trk
```

#### Endpoints

**NOTE:** all sub-endpoints under `/admin` require the `key` query parameter to be set!

- /image/`category`.png = Endpoint for suspect/client.
  - Category:
    - An alphanumeric string (1-32)
  - Query Params:
    - `w` = Width (1-512)
    - `h` = Height (1-512)
    - `c` = Color (RGBA32 integer)
    - `m` = Metadata string (0-255 chars)
- /admin/`command` = Stats and admin API
  - Query Params:
    - `key` = The `ADMIN_PASSWORD` environment variable.
  - Command:
    - `color` = Convert `red` `green` `blue` and `alpha` components into a RGBA32 integer.
      - Query Params:
        - `red` = Red color component (0-255)
        - `green` = Green color component (0-255)
        - `blue` = Blue color component (0-255)
        - `alpha` = Alpha color component (0-255)
	- `stats` = Show the latest hits.
    	- Query Params:
    	- `page` = Page # to navigate (0-100000)
    	- `limit` = Max results per page, shows 50 by default (0-255)
    	- `category` = Filter for a specific category (0-32)
    	- `ip_address` = Filter for a specific IP address (0-45)
    	- `before` = Before a specific UNIX time
    	- `after` = After a specific UNIX time

Examples:
- Generate a semi-transparent greenish yellow rectangle as `neon_glass.png`: http://localhost:8080/image/neon_glass.png?w=100&h=30&c=2164195456
- Generate a 1x1 transparent pixel: http://localhost:8080/image/logo.png
- Get RGBA32 from `red` `green` and `blue`: http://localhost:8080/admin/color?key=test&red=128&green=255&blue=0&alpha=128
- Show paginated results: http://localhost:8080/admin/stats?key=test&limit=5&page=1
