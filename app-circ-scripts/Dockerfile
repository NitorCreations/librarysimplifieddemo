FROM nypl/circ-scripts:2.1
ENTRYPOINT []
WORKDIR /home/simplified/circulation
CMD ["sh", "-c", "export SIMPLIFIED_PRODUCTION_DATABASE=postgres://${DB_USER}:${DB_PASSWORD}@${DB_INSTANCE_ENDPOINT_ADDRESS}:${DB_INSTANCE_ENDPOINT_PORT}/simplified_circ_db && /sbin/my_init"]