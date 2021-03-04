FROM nypl/circ-webapp:3.1.0
WORKDIR /home/simplified/circulation
RUN apt-get update \
  && apt-get install -y openssh-server net-tools \
  && mkdir -p /var/run/sshd
EXPOSE 22
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
CMD ["sh", "-c", "docker-entrypoint.sh && export SIMPLIFIED_PRODUCTION_DATABASE=postgres://${DB_USER}:${DB_PASSWORD}@${DB_INSTANCE_ENDPOINT_ADDRESS}:${DB_INSTANCE_ENDPOINT_PORT}/simplified_circ_db && /sbin/my_init"]