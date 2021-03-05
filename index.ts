import ec2 = require("@aws-cdk/aws-ec2");
import ecs = require("@aws-cdk/aws-ecs");
import elb = require("@aws-cdk/aws-elasticloadbalancingv2");
import ecs_patterns = require("@aws-cdk/aws-ecs-patterns");
import cdk = require("@aws-cdk/core");
import route53 = require("@aws-cdk/aws-route53");
import rds = require("@aws-cdk/aws-rds");
import es = require("./lib/ESDomain");
import secrets = require("@aws-cdk/aws-secretsmanager");
import ssm = require("@aws-cdk/aws-ssm");
import { RemovalPolicy } from "@aws-cdk/core";
import cr = require("@aws-cdk/custom-resources");
import lambda = require("@aws-cdk/aws-lambda");
import logs = require("@aws-cdk/aws-logs");
import iam = require("@aws-cdk/aws-iam");
import certman = require("@aws-cdk/aws-certificatemanager");
import * as path from "path";

const app = new cdk.App();
const stack = new cdk.Stack(app, "LibrarySimplifiedDemo", {
  env: {
    account: "293246570391",
    region: "eu-west-1",
  },
});
const vpc = new ec2.Vpc(stack, "LibrarySimplifiedDemoVPC", {
  maxAzs: 2,
});

const dbSecurityGroup = new ec2.SecurityGroup(
  stack,
  "LibrarySimplifiedDemoDBSG",
  {
    vpc: vpc,
    allowAllOutbound: true,
  }
);

new es.ESDomain(stack, vpc);
const cluster = new ecs.Cluster(stack, "LibrarySimplifiedDemoCluster", {
  vpc: vpc,
  containerInsights: true,
});

const dBCredentials = new secrets.Secret(
  stack,
  "LibrarySimplifiedDemoDBCredentials",
  {
    generateSecretString: {
      excludePunctuation: true,
      includeSpace: false,
      requireEachIncludedType: false,
      excludeCharacters: " %+:;{},.-!\"#€%&/()=?'",
      secretStringTemplate: JSON.stringify({ username: "dbuser" }),
      generateStringKey: "password",
    },
  }
);
const db = new rds.DatabaseInstance(stack, "LibrarySimplifiedDemoDB", {
  vpc: vpc,
  vpcSubnets: {
    subnets: vpc.privateSubnets,
  },
  removalPolicy: RemovalPolicy.DESTROY,
  databaseName: "simplified_circ_db",
  deletionProtection: false,
  credentials: rds.Credentials.fromSecret(dBCredentials),
  port: 5432,
  instanceType: ec2.InstanceType.of(
    ec2.InstanceClass.M3,
    ec2.InstanceSize.MEDIUM
  ),
  engine: rds.DatabaseInstanceEngine.postgres({
    version: rds.PostgresEngineVersion.VER_12,
  }),
  securityGroups: [dbSecurityGroup],
});

dbSecurityGroup.addIngressRule(
  ec2.Peer.anyIpv4(),
  ec2.Port.tcp(
    new rds.Endpoint(
      db.dbInstanceEndpointAddress,
      cdk.Token.asNumber(db.dbInstanceEndpointPort)
    ).port
  ),
  "allow postgre"
);

const sshSecurityGroup = new ec2.SecurityGroup(
  stack,
  "LibrarySimplifiedDemoSSHSG",
  {
    vpc: vpc,
    allowAllOutbound: true,
  }
);
sshSecurityGroup.addIngressRule(
  ec2.Peer.anyIpv4(),
  ec2.Port.tcp(22),
  "allow ssh"
);

const dbInitializer = new lambda.SingletonFunction(stack, "DBInitHandler", {
  uuid: "f7ccf730-4545-11e8-9c2d-fa7ae01aaebc",
  runtime: lambda.Runtime.NODEJS_12_X,
  handler: "index.handler",
  timeout: cdk.Duration.seconds(60),
  code: lambda.Code.fromAsset(path.join(__dirname, "lambda-dbinit")),
  environment: {
    DB_INSTANCE_ENDPOINT_ADDRESS: db.dbInstanceEndpointAddress,
    DB_INSTANCE_ENDPOINT_PORT: db.dbInstanceEndpointPort,
    DB_SECRET_ARN: dBCredentials.secretArn,
  },
  securityGroups: [
    ec2.SecurityGroup.fromSecurityGroupId(
      stack,
      "DefaultSecurityGroup",
      vpc.vpcDefaultSecurityGroup
    ),
  ],
  vpc: vpc,
  vpcSubnets: {
    subnets: vpc.privateSubnets,
  },
});
dbInitializer.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: [dBCredentials.secretArn],
    actions: ["secretsmanager:GetSecretValue"],
  })
);
dbInitializer.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: [db.instanceArn],
    actions: ["rds-data:ExecuteStatement", "rds-data:BatchExecuteStatement"],
  })
);
dbInitializer.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: ["*"],
    actions: [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ],
  })
);
dbInitializer.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: ["*"],
    actions: [
      "ec2:DescribeNetworkInterfaces",
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeInstances",
      "ec2:AttachNetworkInterface",
    ],
  })
);
dbInitializer.node.addDependency(vpc);

const dbInitProvider = new cr.Provider(stack, "DBInitProvider", {
  onEventHandler: dbInitializer,
  logRetention: logs.RetentionDays.ONE_DAY,
});
dbInitProvider.node.addDependency(db);

const hostedZone = route53.HostedZone.fromLookup(stack, "NitoriousHZ", {
  domainName: "nitorio.us",
});

const containerAuthorizedPublicKey = ssm.StringParameter.fromStringParameterName(
  stack,
  "LibrarySimplifiedAuthorizedPublicKey",
  "librarySimplifiedAuthorizedPublicKey"
);

const webappService = new ecs_patterns.ApplicationLoadBalancedFargateService(
  stack,
  "CirculationWebappService",
  {
    cluster,
    certificate: new certman.Certificate(
      stack,
      "LibrarySimplifiedDemoCirculationServerCert",
      {
        domainName: "lsdemocirculation.nitorio.us",
        validation: {
          method: certman.ValidationMethod.DNS,
          props: {
            hostedZone: hostedZone,
          },
        },
      }
    ),
    taskSubnets: {
      subnets: vpc.privateSubnets,
    },
    securityGroups: [
      ec2.SecurityGroup.fromSecurityGroupId(
        stack,
        "LSCVPCDefaultSecurityGroupWS",
        vpc.vpcDefaultSecurityGroup
      ),
      dbSecurityGroup,
      sshSecurityGroup,
    ],
    openListener: true,
    desiredCount: 1,
    protocol: elb.ApplicationProtocol.HTTPS,
    targetProtocol: elb.ApplicationProtocol.HTTP,
    domainName: "lsdemocirculation",
    domainZone: hostedZone,
    platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
    memoryLimitMiB: 2048,
    cpu: 1024,
    taskImageOptions: {
      image: ecs.ContainerImage.fromAsset("./app-circ-webapp"),
      containerPort: 80,
      secrets: {
        DB_USER: ecs.Secret.fromSecretsManager(dBCredentials, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dBCredentials, "password"),
        SSH_PUBLIC_KEY: ecs.Secret.fromSsmParameter(
          containerAuthorizedPublicKey
        ),
      },
      environment: {
        TZ: "Europe/Helsinki",
        DB_INSTANCE_ENDPOINT_ADDRESS: db.dbInstanceEndpointAddress,
        DB_INSTANCE_ENDPOINT_PORT: db.dbInstanceEndpointPort,
      },
    },
  }
);
webappService.taskDefinition.taskRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: ["*"],
    actions: ["es:*"],
  })
);
webappService.targetGroup.configureHealthCheck({
  path: "/heartbeat",
});
webappService.node.addDependency(dbInitProvider);

const patronWebappService = new ecs_patterns.ApplicationLoadBalancedFargateService(
  stack,
  "CirculationPatronWebappService",
  {
    cluster,
    certificate: new certman.Certificate(
      stack,
      "LibrarySimplifiedDemoServerCert",
      {
        domainName: "lsdemo.nitorio.us",
        validation: {
          method: certman.ValidationMethod.DNS,
          props: {
            hostedZone: hostedZone,
          },
        },
      }
    ),
    taskSubnets: {
      subnets: vpc.privateSubnets,
    },
    securityGroups: [
      ec2.SecurityGroup.fromSecurityGroupId(
        stack,
        "LSCVPCDefaultSecurityGroupPWS",
        vpc.vpcDefaultSecurityGroup
      ),
      dbSecurityGroup,
      sshSecurityGroup,
    ],
    openListener: true,
    desiredCount: 1,
    protocol: elb.ApplicationProtocol.HTTPS,
    targetProtocol: elb.ApplicationProtocol.HTTP,
    domainName: "lsdemo",
    domainZone: hostedZone,
    platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
    memoryLimitMiB: 2048,
    cpu: 1024,
    taskImageOptions: {
      image: ecs.ContainerImage.fromAsset("./app-patron-web"),
      containerPort: 3000,
    },
  }
);
patronWebappService.targetGroup.configureHealthCheck({
  path: "/",
});

const circulationScriptsTaskDefinition = new ecs.FargateTaskDefinition(
  stack,
  "CirculationScriptsTaskDefinition"
);
const container = circulationScriptsTaskDefinition.addContainer(
  "CirculationScriptsContainer",
  {
    image: ecs.ContainerImage.fromAsset("./app-circ-scripts"),
    healthCheck: { command: ["CMD-SHELL", "exit 0"] },
    secrets: {
      DB_USER: ecs.Secret.fromSecretsManager(dBCredentials, "username"),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dBCredentials, "password"),
      SSH_PUBLIC_KEY: ecs.Secret.fromSsmParameter(containerAuthorizedPublicKey),
    },
    environment: {
      TZ: "Europe/Helsinki",
      DB_INSTANCE_ENDPOINT_ADDRESS: db.dbInstanceEndpointAddress,
      DB_INSTANCE_ENDPOINT_PORT: db.dbInstanceEndpointPort,
    },
    logging: ecs.LogDriver.awsLogs({
      streamPrefix: "LibrarySimplifiedDemoScriptsContainer",
    }),
  }
);
container.addPortMappings({ containerPort: 22, hostPort: 22 });
const scriptsService = new ecs.FargateService(
  stack,
  "CirculationScriptsService",
  {
    cluster: cluster,
    platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
    taskDefinition: circulationScriptsTaskDefinition,
    desiredCount: 1,
    securityGroups: [
      ec2.SecurityGroup.fromSecurityGroupId(
        stack,
        "CSSVPCDefaultSecurityGroup",
        vpc.vpcDefaultSecurityGroup
      ),
      dbSecurityGroup,
      sshSecurityGroup,
    ],
  }
);
scriptsService.node.addDependency(dbInitProvider);

const bastion = new ec2.BastionHostLinux(stack, "LSDemoBastion", {
  vpc: vpc,
  instanceName: "LibrarySimplifiedDemoBastion",
  instanceType: new ec2.InstanceType("t3.micro"),
  machineImage: new ec2.AmazonLinuxImage(),
  securityGroup: dbSecurityGroup,
});
bastion.instance.addUserData(
  "sudo yum update -y",
  "sudo yum install -y postgresql12"
);

app.synth();
