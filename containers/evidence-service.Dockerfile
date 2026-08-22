ARG EVIDENCE_BASE_IMAGE=python:3.12-alpine3.22
FROM ${EVIDENCE_BASE_IMAGE}

# TShark is installed without dumpcap privileges. This image decodes uploaded
# files only and cannot capture from host or container interfaces.
RUN apk add --no-cache tshark \
    && addgroup -S -g 10001 nettap \
    && adduser -S -D -H -u 10001 -G nettap nettap \
    && mkdir -p /data \
    && chown 10001:10001 /data

WORKDIR /service
USER 10001:10001
