'use strict';
const AWS = require('aws-sdk');
const pg = require('pg');
exports.handler = async function(event) {
  console.log('Received event : ' + JSON.stringify(event) + ' at ' + new Date());
  const promise = new Promise((resolve, reject) => {
    new AWS.SecretsManager()
      .getSecretValue({SecretId: process.env.DB_SECRET_ARN})
      .promise()
      .then(
        credsJson => {
          const credentials = JSON.parse(credsJson.SecretString);
          const connectionString = `postgres://${credentials['username']}:${credentials['password']}@${process.env.DB_INSTANCE_ENDPOINT_ADDRESS}:${process.env.DB_INSTANCE_ENDPOINT_PORT}/`
          console.log("Configuration fetch success: " +
            (credentials['username'] && credentials['username'] && process.env.DB_INSTANCE_ENDPOINT_ADDRESS && process.env.DB_INSTANCE_ENDPOINT_PORT))
          var client = new pg.Client({ connectionString: connectionString + "postgres"})
          client.connect()
          console.log("Dropping database");
          client.query('drop database if exists simplified_circ_db;')
            .then((res, err) => {
              if(err) throw err
              console.log("Dropped database: " + res)
              console.log("Running create database");
              client.query('create database simplified_circ_db;')
                .then((res, err)=>{
                  if(err) throw err
                  console.log("Created database: " + res)
                  client.end();
                  client = new pg.Client({ connectionString: connectionString + "/simplified_circ_db"})
                  console.log("Granting privileges: " + res)
                  client.query('grant all privileges on database simplified_circ_db to ' + credentials['username'])
                  .then((res, err)=>{
                    if(err) throw err
                    console.log("Granted privileges: " + res)
                    client.query('create extension pgcrypto;')
                    .then((res, err)=>{
                      client.end();
                      resolve();  
                  })
                })
              })
            })
          })
        }
      );
  return promise;
};
