FROM node:alpine3.18
LABEL name="img-trk"
LABEL description="Small image tracking API/Service, can be used in emails or webpages."

ADD ./package*.json /mnt/

RUN cd /mnt/ \
	&& npm i

WORKDIR /mnt/

CMD ["node", "./app/"]

EXPOSE 8080/tcp
