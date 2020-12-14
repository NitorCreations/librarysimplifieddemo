import cdk = require('@aws-cdk/core');
import iam = require('@aws-cdk/aws-iam');
import { CfnDomain } from '@aws-cdk/aws-elasticsearch';
import { IVpc } from '@aws-cdk/aws-ec2';

interface ESContext {
  readonly version: string;
  readonly domainName: string;
  readonly masterInstanceType: string;
  readonly instanceType: string;
  readonly instanceCount: number;
  readonly volumeSize: number;
  readonly availabilityZoneCount: 1 | 2 | 3;
  readonly zoneAwareness: boolean;
  readonly dedicatedMaster: boolean;
  readonly encryption: boolean;
}

export class ESDomain {
  public endpoint: string;
  constructor(scope: cdk.Construct, vpc: IVpc) {
    const stage: string = scope.node.tryGetContext('stage');
    const esVersion: string = scope.node.tryGetContext('es').version;
    const esContext: ESContext = scope.node.tryGetContext(stage).es;
    //const sourceIp: string = scope.node.tryGetContext('sourceIp');
    const serviceLinkedRole = new iam.CfnServiceLinkedRole(scope, "ESServiceLinkedRole", {
      awsServiceName: "es.amazonaws.com",
      description: 'Role for ES to access resources in my VPC'
    })
    const domain = new CfnDomain(scope, esContext.domainName || 'domain', {
      accessPolicies: {
        Version: '2012-10-17',
        Statement: [
/*          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['es:*'],
            Resource: `arn:aws:es:${cdk.Stack.of(scope).region}:${cdk.Stack.of(scope).account}:domain/${esContext.domainName}/*`,
            Condition: { IpAddress: { 'aws:SourceIp': `${sourceIp || '127.0.0.1'}` } }
          },*/
          {
            Effect: 'Allow',
            Principal: { AWS: [ cdk.Stack.of(scope).account ] },
            Action: [ 'es:*' ],
            Resource: `arn:aws:es:${cdk.Stack.of(scope).region}:${cdk.Stack.of(scope).account}:domain/${esContext.domainName}/*`
          }
        ]
      },
      domainName: esContext.domainName,
      ebsOptions: {
        ebsEnabled: true,
        volumeSize: esContext.volumeSize,
        volumeType: 'gp2',
      },
      elasticsearchClusterConfig: {
        instanceCount: esContext.instanceCount,
        instanceType: esContext.instanceType,
        // dedicatedMasterEnabled: true,
        // dedicatedMasterCount: 3,
        // dedicatedMasterType: esContext.masterInstanceType,
        zoneAwarenessEnabled: true,
        zoneAwarenessConfig: {
          availabilityZoneCount: esContext.availabilityZoneCount
        }
      },
      elasticsearchVersion: esVersion,
      encryptionAtRestOptions: {
        enabled: esContext.encryption
      },
      nodeToNodeEncryptionOptions: {
        enabled: false
      },
      snapshotOptions: {
        automatedSnapshotStartHour: 0
      },
      vpcOptions: {
        subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId)
      }
    });
    domain.node.addDependency(serviceLinkedRole);

    this.endpoint = domain.attrDomainEndpoint;
  }
}