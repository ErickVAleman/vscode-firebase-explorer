import * as request from 'request-promise-native';
import { contains } from '../utils';
import { AccountInfo, AccountManager } from '../accounts/AccountManager';
import { FirebaseProject } from '../projects/ProjectManager';
import { getDetailsFromName } from './utils';

/*
  Documentation:
  https://cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions
*/

const CONFIG = {
  version: 'v1',
  origin: 'https://cloudfunctions.googleapis.com',
  logging: {
    version: 'v2',
    origin: 'https://logging.googleapis.com'
  }
};

const instances: { [k: string]: FunctionsAPI } = {};

export class FunctionsAPI {
  static for(account: AccountInfo, project: FirebaseProject): FunctionsAPI {
    const id = account.user.email + '--' + project.projectId;

    if (!contains(instances, id)) {
      instances[id] = new FunctionsAPI(account, project);
    }

    return instances[id];
  }

  accountManager: AccountManager;

  private constructor(account: AccountInfo, public project: FirebaseProject) {
    this.accountManager = AccountManager.for(account);
  }

  private async authedRequest(
    method: string,
    resource: string,
    options: Partial<request.OptionsWithUrl> = {}
  ) {
    const token = await this.accountManager.getAccessToken();
    const reqOptions: request.OptionsWithUrl = {
      method,
      url: `${CONFIG.origin}/${resource}`,
      resolveWithFullResponse: true,
      json: true,
      ...options
    };

    reqOptions.headers = {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'VSCodeFirebaseExtension/' + EXTENSION_VERSION,
      'X-Client-Version': 'VSCodeFirebaseExtension/' + EXTENSION_VERSION,
      ...options.headers
    };

    return request(reqOptions);
  }

  async list(region = '-'): Promise<CloudFunction[] | null> {
    const endpoint = `${CONFIG.version}/projects/${
      this.project.projectId
    }/locations/${region}/functions`;

    try {
      const response = await this.authedRequest('GET', endpoint);
      return response.body.functions || [];
    } catch (err) {
      if (err.statusCode === 403) {
        // Cloud Functions is not enabled for this project
        return null;
      } else {
        console.log(`Failed to list functions for ${this.project.projectId}`, {
          err
        });
        throw err;
      }
    }
  }

  async trigger(method: string, fn: CloudFunction) {
    if (fn.httpsTrigger) {
      try {
        const response = await request({
          method,
          url: fn.httpsTrigger.url,
          resolveWithFullResponse: true
        });
        return parseBody(response);
      } catch (err) {
        err.response = parseBody(err.response);
        console.log(`Failed to trigger function ${fn.name}`, { err });
        throw err;
      }
    } else {
      try {
        const response = await this.authedRequest('POST', fn.name + ':call');
        return response;
      } catch (err) {
        console.log(`Failed to trigger function ${fn.name}`, { err });
        throw err;
      }
    }
  }

  async getLog(
    fn: CloudFunction,
    _options: {
      pageSize?: number;
      order?: 'asc' | 'desc';
      since?: {
        timestamp: string;
        insertId: string;
      };
    } = {}
  ): Promise<CloudFunctionLogEntry[]> {
    const details = getDetailsFromName(fn.name);
    const options = {
      pageSize: 50,
      order: 'desc',
      ..._options
    };

    // Basic filters. Covers log entries generated before "right now".
    let filter = `
      severity != NOTICE
      resource.labels.function_name = (${details.name})
      resource.type="cloud_function"
      timestamp<"${new Date().toISOString()}"
    `;

    if (options.since) {
      // If requested, we only retrieve log entries that have been created
      // after the last one we've seen
      filter += `(
        timestamp>"${options.since.timestamp}"
        OR
        (
          timestamp="${options.since.timestamp}"
          insertId>"${options.since.insertId}"
        )
      )`;
    }

    filter = filter
      .replace(/[\r\n]/g, ' ')
      .replace(/ +/g, ' ')
      .trim();

    const url = `${CONFIG.logging.origin}/${
      CONFIG.logging.version
    }/entries:list`;
    const response = await this.authedRequest('POST', '', {
      url,
      body: {
        // projectIds: [details.projectId],
        resourceNames: [`projects/${details.projectId}`],
        filter,
        orderBy: 'timestamp ' + options.order,
        pageSize: options.pageSize
      }
    });
    return response.body.entries || [];
  }
}

function parseBody(response: request.FullResponse) {
  if (!response || !response.headers || !response.headers['content-type']) {
    return response;
  }

  if (response.headers['content-type'].match(/^application\/json/)) {
    response.body = JSON.parse(response.body);
  }

  return response;
}

interface CloudFunctionBase {
  name: string;
  description?: string;
  status: CloudFunctionStatus;
  entryPoint: string;
  runtime: string; // 'nodejs6',
  timeout: string;
  availableMemoryMb: number;
  serviceAccountEmail: string;
  updateTime: string;
  versionId: string; // '20'
  labels: {
    // 'deployment-tool': string;
    [k: string]: string;
  };
  environmentVariables?: {
    [k: string]: string;
  };
  network?: string;
  maxInstances?: number;

  // Union field source_code can be only one of the following:
  sourceArchiveUrl?: string;
  sourceRepository?: {
    url: string;
    deployedUrl: string;
  };
  sourceUploadUrl?: string;
  // End of list of possible types for union field source_code.
}

export interface CloudFunctionEventTrigger {
  eventType: string;
  resource: string;
  service: string;
  failurePolicy: {
    retry: {
      // Don't know what goes here...
    };
  };
}

export interface CloudFunctionEventTriggerFailurePolicy {
  // ...
}

export interface CloudFunctionWithEventTrigger extends CloudFunctionBase {
  eventTrigger: CloudFunctionEventTrigger;
}

export interface CloudFunctionWithHttpsTrigger extends CloudFunctionBase {
  httpsTrigger: {
    url: string;
  };
}

export type CloudFunction = CloudFunctionWithEventTrigger &
  CloudFunctionWithHttpsTrigger;

export enum CloudFunctionTriggerType {
  Event = 'event',
  HTTPS = 'https',
  Other = 'other'
}

export enum CloudFunctionStatus {
  // Not specified. Invalid state.
  CLOUD_FUNCTION_STATUS_UNSPECIFIED = 'CLOUD_FUNCTION_STATUS_UNSPECIFIED',

  // Function has been succesfully deployed and is serving.
  ACTIVE = 'ACTIVE',

  // Function deployment failed and the function isn’t serving.
  OFFLINE = 'OFFLINE',

  // Function is being created or updated.
  DEPLOY_IN_PROGRESS = 'DEPLOY_IN_PROGRESS',

  // Function is being deleted.
  DELETE_IN_PROGRESS = 'DELETE_IN_PROGRESS',

  // Function deployment failed and the function serving state is
  // undefined. The function should be updated or deleted to move
  // it out of this state.
  UNKNOWN = 'UNKNOWN'
}

export interface CloudFunctionLogEntry {
  logName: string;
  resource: {
    type: string;
    labels: {
      [k: string]: string;
    };
  };
  timestamp: string;
  receiveTimestamp: string;
  severity: CloudFunctionLogSeverity;
  insertId: string;
  httpRequest: {
    requestMethod: string;
    requestUrl: string;
    requestSize: string;
    status: number;
    responseSize: string;
    userAgent: string;
    remoteIp: string;
    serverIp: string;
    referer: string;
    latency: string;
    cacheLookup: boolean;
    cacheHit: boolean;
    cacheValidatedWithOriginServer: boolean;
    cacheFillBytes: string;
    protocol: string;
  };
  labels: {
    [k: string]: string;
  };
  metadata: {
    systemLabels: {
      [k: string]: any;
    };
    userLabels: {
      [k: string]: string;
    };
  };
  operation: {
    id: string;
    producer: string;
    first: boolean;
    last: boolean;
  };
  trace: string;
  spanId: string;
  traceSampled: boolean;
  sourceLocation: {
    file: string;
    line: string;
    function: string;
  };

  // Union field payload can be only one of the following:
  protoPayload?: {
    '@type': string;
    [k: string]: any;
  };
  textPayload?: string;
  jsonPayload?: {
    [k: string]: any;
  };
  // End of list of possible types for union field payload.
}

export enum CloudFunctionLogSeverity {
  DEFAULT = 'DEFAULT',
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  NOTICE = 'NOTICE',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
  ALERT = 'ALERT',
  EMERGENCY = 'EMERGENCY'
}
