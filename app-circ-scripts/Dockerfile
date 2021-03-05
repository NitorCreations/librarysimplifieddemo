FROM nypl/circ-scripts:3.1.0
WORKDIR /home/simplified/circulation/bin
RUN rm -f /etc/service/sshd/down
EXPOSE 22
COPY docker-entrypoint.sh /usr/local/bin/
COPY sshd_config /etc/ssh/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
CMD ["sh", "-c", "docker-entrypoint.sh && export SIMPLIFIED_PRODUCTION_DATABASE=postgres://${DB_USER}:${DB_PASSWORD}@${DB_INSTANCE_ENDPOINT_ADDRESS}:${DB_INSTANCE_ENDPOINT_PORT}/simplified_circ_db && (/sbin/my_init &) && touch /var/log/cron.log && tail -F /var/log/cron.log"]