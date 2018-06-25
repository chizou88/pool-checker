'use strict';
require('dotenv').config();
require('date-utils');
const config = require('config');
const cron = require('node-cron');
const portscanner = require('portscanner');
const request = require('request');
const exec = require('child_process').exec;

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

const MAX_RETRY = config.maxRetry;

/*** check MPOS API reachability ***/
const checkAPI = async(uri) => {
  const data = await new Promise((resolve) => {
    request.get(uri, { timeout : config.timeout.api || 1000 }, (error, response, body) => {
      if(error) { resolve({ error }); }
      else { resolve({ body }); }
    });
  });
  if(!data.error) {
    try {
      data.json = JSON.parse(data.body);
    } catch(err) {
      if(err.name === 'SyntaxError') { data.error = err.name; }
      else { console.error(err); }
    }
  }
  return data;
};

/*** check Stratum Port reachability ***/
const checkStratum = async(host, port) => {
  const portStatus = await portscanner.checkPortStatus(port, {
    host,
    timeout : config.timeout.stratum || 1000
  }).catch(err => {
    console.error(err);
    return false;
  });
  return portStatus === 'open' ? true : false;
};

const checkCurrentStatus = async() => {
  let isReturn = false;
  let text = '';
  for(const web of config.webs) {
    console.info(`[${new Date()}] Checking ${web.name}...`);
    const status = { api : false };

    if(!web.restarTarget) {
      status.api = true;
    }
    for(let retry = 0; retry < MAX_RETRY; ++retry) {
      const api = await checkAPI(web.url + (config.apiPath[web.type]));
      if(api.error) { continue; }
      status.api = true;
      for(const pool of web.pools) {
        let hashRate = 0;
        hashRate = api.json.pools.[pool.coin].hashrate;
        text += `${pool.coin}\n`
             + `hashrate: hashRate\n`
             + `(${(new Date()).toFormat('YYYY/MM/DD HH24:MI:SS')} JST)\n`;
        console.info(text);
        if(!${pool.threshold} > hashRate) {
          isReturn = true;
          exec(`pm2 restart ${pool.pm2id}`, (err, stdout, stderr) => {
          if (err) { console.log(err); }
          console.log(stdout);
          });
        }
      }
      break;
    }

    text += `${web.url}\n`
          + `Webダッシュボード: ${status.api ? '\u2705 正常' : '\u26a0 停止'}\n`
          + `(${(new Date()).toFormat('YYYY/MM/DD HH24:MI:SS')} JST)\n`;
    console.info(text);
    if(!status.api) {
      exec(`pm2 restart ${web.pm2id}`, (err, stdout, stderr) => {
        if (err) { console.log(err); }
        console.log(stdout);
      });
    }
  }

  if (isReturn) { 
    return; 
  }
  for(const stratum of config.stratums) {
    console.info(`[${new Date()}] Checking ${stratum.name}...`);
    const status = { stratum : false };

    for(let retry = 0; retry < MAX_RETRY; ++retry) {
      status.stratum = await checkStratum(stratum.host, stratum.port);
      if(status.stratum) { break; }
    }

      let text = '';
      text += `${stratum.host}:${stratum.port}\n`
            + `Stratumポート: ${status.stratum ? '\u2705 正常' : '\u26a0 停止'}\n`
            + `(${(new Date()).toFormat('YYYY/MM/DD HH24:MI:SS')} JST)\n`;
      console.info(text);
    if(!status.stratum) {
      exec(`pm2 restart ${stratum.pm2id}`, (err, stdout, stderr) => {
        if (err) { console.log(err); }
        console.log(stdout);
      });
    }
  }
};

if(process.env.DEBUG) {
  (async() => {
    await checkCurrentStatus();
  })();
}
else {
  cron.schedule('*/1 * * * *', () => {
    checkCurrentStatus();
  });
}
