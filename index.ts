import ec2 = require('@aws-cdk/aws-ec2');
import ecs = require('@aws-cdk/aws-ecs');
import elb = require('@aws-cdk/aws-elasticloadbalancingv2');
import ecs_patterns = require('@aws-cdk/aws-ecs-patterns');
import cdk = require('@aws-cdk/core');
import route53 = require('@aws-cdk/aws-route53');
import rds = require('@aws-cdk/aws-rds');
import es = require('./lib/ESDomain');
import secrets = require('@aws-cdk/aws-secretsmanager');
import { RemovalPolicy } from '@aws-cdk/core';
import cr = require('@aws-cdk/custom-resources');
import lambda = require('@aws-cdk/aws-lambda');
import logs = require('@aws-cdk/aws-logs');
import iam = require('@aws-cdk/aws-iam');
import certman = require('@aws-cdk/aws-certificatemanager');
import * as path from 'path';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'LibrarySimplifiedDemo', {
  env: {
    account: '293246570391',
    region: 'eu-west-1'
  }
});
const vpc = new ec2.Vpc(stack, 'LibrarySimplifiedDemoVPC', {
  maxAzs: 2,
});

const dbSecurityGroup = new ec2.SecurityGroup(stack, "LibrarySimplifiedDemoDBSG", {
  vpc: vpc,
  allowAllOutbound: true
});

new es.ESDomain(stack, vpc);
const cluster = new ecs.Cluster(stack, 'LibrarySimplifiedDemoCluster', {
  vpc: vpc,
  containerInsights: true
});

const dBCredentials = new secrets.Secret(stack, 'LibrarySimplifiedDemoDBCredentials', {
  generateSecretString: {
    excludePunctuation: true,
    includeSpace: false,
    requireEachIncludedType: false,
    excludeCharacters: ' %+:;{},.-!"#€%&/()=?\'',
    secretStringTemplate: JSON.stringify({ username: 'dbuser' }),
    generateStringKey: 'password',
  },
});
const db = new rds.DatabaseInstance(stack, "LibrarySimplifiedDemoDB", {
  vpc: vpc,
  vpcSubnets: {
    subnets: vpc.privateSubnets
  },
  removalPolicy: RemovalPolicy.DESTROY,
  databaseName: 'simplified_circ_db',
  deletionProtection: false,
  credentials: rds.Credentials.fromSecret(dBCredentials),
  port: 5432,
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.M3, ec2.InstanceSize.MEDIUM),
  engine: rds.DatabaseInstanceEngine.postgres({
    version: rds.PostgresEngineVersion.VER_9_5_23,
  }),
  securityGroups: [ dbSecurityGroup ]
});

dbSecurityGroup.addIngressRule(
  ec2.Peer.anyIpv4(), ec2.Port.tcp(
    new rds.Endpoint(
      db.dbInstanceEndpointAddress,
      cdk.Token.asNumber(db.dbInstanceEndpointPort)).port
  ), 'allow postgre'
);

const dbInitializer = new lambda.SingletonFunction(stack, 'DBInitHandler', {
  uuid: "f7ccf730-4545-11e8-9c2d-fa7ae01aaebc",
  runtime: lambda.Runtime.NODEJS_12_X,
  handler: 'index.handler',
  timeout: cdk.Duration.seconds(60),
  code: lambda.Code.fromAsset(path.join(__dirname, 'lambda-dbinit')),
  environment: {
    "DB_INSTANCE_ENDPOINT_ADDRESS": db.dbInstanceEndpointAddress,
    "DB_INSTANCE_ENDPOINT_PORT": db.dbInstanceEndpointPort,
    "DB_SECRET_ARN": dBCredentials.secretArn
  },
  securityGroups: [ 
    ec2.SecurityGroup.fromSecurityGroupId(stack, "DefaultSecurityGroup", vpc.vpcDefaultSecurityGroup)
  ],
  vpc: vpc,
  vpcSubnets: {
    subnets: vpc.privateSubnets
  },
});
dbInitializer.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  resources: [dBCredentials.secretArn],
  actions: ["secretsmanager:GetSecretValue"]
}))
dbInitializer.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  resources: [db.instanceArn],
  actions: ["rds-data:ExecuteStatement", "rds-data:BatchExecuteStatement"]
}))
dbInitializer.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  resources: ["*"],
  actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
}))
dbInitializer.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  resources: ["*"],
  actions: ["ec2:DescribeNetworkInterfaces", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeInstances", "ec2:AttachNetworkInterface"]
}))
dbInitializer.node.addDependency(vpc);

const dbInitProvider = new cr.Provider(stack, 'DBInitProvider', {
  onEventHandler: dbInitializer,
  logRetention: logs.RetentionDays.ONE_DAY
})
dbInitProvider.node.addDependency(db);
const hostedZone = route53.HostedZone.fromLookup(stack, 'NitoriousHZ', { domainName: 'nitorio.us' });
const webappService = new ecs_patterns.ApplicationLoadBalancedFargateService(stack, "CirculationWebappService", {
  cluster,
  certificate: new certman.Certificate(stack, "LibrarySimplifiedDemoCirculationServerCert", {
    domainName: 'lsdemocirculation.nitorio.us',
    validation: {
      method: certman.ValidationMethod.DNS,
      props: {
        hostedZone: hostedZone  
      }
    }
  }),
  taskSubnets: {
    subnets: vpc.privateSubnets
  },
  openListener: true,
  desiredCount: 1,
  protocol: elb.ApplicationProtocol.HTTPS,
  targetProtocol: elb.ApplicationProtocol.HTTP,
  domainName: 'lsdemocirculation',
  domainZone: hostedZone,
  platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
  taskImageOptions: {
    image: ecs.ContainerImage.fromAsset('./app-circ-webapp'),
    containerPort: 80,
    secrets: {
      DB_USER: ecs.Secret.fromSecretsManager(dBCredentials, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dBCredentials, 'password'),
    },
    environment: {
      'TZ': 'Europe/Helsinki',
      'DB_INSTANCE_ENDPOINT_ADDRESS':  db.dbInstanceEndpointAddress,
      'DB_INSTANCE_ENDPOINT_PORT':  db.dbInstanceEndpointPort
    }  
  },
});
webappService.targetGroup.configureHealthCheck({
  path: "/heartbeat"
})
webappService.node.addDependency(dbInitProvider);


const circulationScriptsTaskDefinition = new ecs.FargateTaskDefinition(stack, "CirculationScriptsTaskDefinition");
circulationScriptsTaskDefinition.addContainer("Service2Container", {
  image: ecs.ContainerImage.fromAsset('./app-circ-webapp'),
  healthCheck: { command: [ "CMD-SHELL", "exit 0" ] },
  secrets: {
    DB_USER: ecs.Secret.fromSecretsManager(dBCredentials, 'username'),
    DB_PASSWORD: ecs.Secret.fromSecretsManager(dBCredentials, 'password'),
  },
  environment: {
    'TZ': 'Europe/Helsinki',
    'DB_INSTANCE_ENDPOINT_ADDRESS':  db.dbInstanceEndpointAddress,
    'DB_INSTANCE_ENDPOINT_PORT':  db.dbInstanceEndpointPort
  }
});
const scriptsService = new ecs.FargateService(stack, "CirculationScriptsService", {
  cluster: cluster,
  platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
  taskDefinition: circulationScriptsTaskDefinition,
  desiredCount: 1
});
scriptsService.node.addDependency(dbInitProvider)

app.synth();