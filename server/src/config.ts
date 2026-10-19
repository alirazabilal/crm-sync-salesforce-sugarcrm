// Central place for settings. Values come from ../.env (loaded by node --env-file).

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required setting ${name} in .env`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  syncCron: process.env.SYNC_CRON ?? '*/5 * * * *',
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://localhost:27017/crm_sync',

  // Secrets are read on first use (getters), so unit tests run without a .env file
  salesforce: {
    get loginUrl() {
      return required('SF_LOGIN_URL');
    },
    get clientId() {
      return required('SF_CLIENT_ID');
    },
    get clientSecret() {
      return required('SF_CLIENT_SECRET');
    },
    apiVersion: process.env.SF_API_VERSION ?? 'v62.0',
  },

  sugar: {
    url: process.env.SUGAR_URL ?? 'http://localhost:8081',
    get username() {
      return required('SUGAR_USERNAME');
    },
    get password() {
      return required('SUGAR_PASSWORD');
    },
  },

  // Rules used by the workflow engine
  workflows: {
    hotLeadScore: 70,
    staleDealDays: 14,
  },
};
