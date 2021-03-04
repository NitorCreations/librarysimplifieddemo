FROM nypl/circ-exec:3.1.0
WORKDIR /home/simplified/circulation/bin
CMD ["sh", "-c", "export SIMPLIFIED_PRODUCTION_DATABASE=postgres://${DB_USER}:${DB_PASSWORD}@${DB_INSTANCE_ENDPOINT_ADDRESS}:${DB_INSTANCE_ENDPOINT_PORT}/simplified_circ_db && /sbin/my_init"]