import * as request from 'request-promise-native';
import { contains } from '../utils';
import { APIforCLI } from './cli';
import { AccountInfo, GoogleOAuthAccessToken } from './AccountManager';

export const API_CONFIG = {
  clientId:
    '877476249439-8vpbm9f7r5mvqge6ctu056prbb0did6a.apps.googleusercontent.com',
  clientSecret: 'TseOCjZ0MXoReF0EL65W-1WG',
  authOrigin: 'https://accounts.google.com',
  refreshTokenHost: 'www.googleapis.com',
  refreshTokenPath: '/oauth2/v4/token'
};

const instances: { [k: string]: AccountsAPI } = {};

export class AccountsAPI {
  static for(account: AccountInfo): AccountsAPI {
    const id = account.user.email;

    if (!contains(instances, id)) {
      instances[id] = new AccountsAPI(account);
    }

    return instances[id];
  }

  private constructor(public account: AccountInfo) {}

  async getAccessToken(): Promise<GoogleOAuthAccessToken> {
    const reqOptions: request.OptionsWithUrl = {
      method: 'POST',
      url: `https://${API_CONFIG.refreshTokenHost}${API_CONFIG.refreshTokenPath}`,
      formData: {
        grant_type: 'refresh_token',
        refresh_token: this.account.tokens.refresh_token,
        client_id:
          this.account.origin === 'cli' ? APIforCLI.clientId : API_CONFIG.clientId,
        client_secret:
          this.account.origin === 'cli'
            ? APIforCLI.clientSecret
            : API_CONFIG.clientSecret
      },
      resolveWithFullResponse: true
    };

    let resp: request.FullResponse;

    try {
      resp = await request(reqOptions);
    } catch (err) {
      const error = JSON.parse(err.error);
      let message = 'Error fetching access token: ' + error.error;
      if (error.error_description) {
        message += ' (' + error.error_description + ')';
      }
      throw new Error(message);
    }

    const token: GoogleOAuthAccessToken = JSON.parse(resp.body);
    if (!token.access_token || !token.expires_in) {
      throw new Error(
        `Unexpected response while fetching access token: ${resp.body}`
      );
    } else {
      return token;
    }
  }
}
