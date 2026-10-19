// Installs the Deal Reviews custom module into the SuiteCRM container (safe to run again).
// Copies the module files, runs Quick Repair & Rebuild to create the table, then clears the cache.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CONTAINER = process.env.SUITECRM_CONTAINER ?? 'crm-suitecrm';
const ROOT = '/bitnami/suitecrm';
const LEGACY = `${ROOT}/public/legacy`;
const moduleDir = fileURLToPath(new URL('../../suitecrm/', import.meta.url));

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function run(cmd: string, user = 'daemon') {
  return docker('exec', '-u', user, CONTAINER, 'sh', '-c', cmd);
}

console.log('1. Copying module files');
docker('cp', path.join(moduleDir, 'DealReviews') + '/.', `${CONTAINER}:${LEGACY}/`);
docker('cp', path.join(moduleDir, 'install-module.php'), `${CONTAINER}:${LEGACY}/install-module.php`);
run(`chown -R daemon:root ${LEGACY}/modules/DealReviews ${LEGACY}/custom ${LEGACY}/install-module.php`, 'root');

console.log('2. Repair & rebuild (creates the deal_reviews table)');
const out = run(`cd ${LEGACY} && php install-module.php 2>/dev/null | tail -n 1`);
console.log('   ' + out.trim());
run(`rm -f ${LEGACY}/install-module.php`, 'root');

console.log('3. Fixing the site URL');
// The Bitnami installer appends its internal port to SUITECRM_HOST (http://localhost:8081:8080),
// which breaks the SuiteCRM 8 login page. Point it at the URL we actually publish.
const siteUrl = process.env.SUGAR_URL ?? 'http://localhost:8081';
run(`sed -i "s#'site_url' => '[^']*'#'site_url' => '${siteUrl}'#" ${LEGACY}/config.php`);

console.log('4. Clearing the SuiteCRM 8 cache');
run(`cd ${ROOT} && php bin/console cache:clear --no-warmup >/dev/null 2>&1 || true`);

if (!out.includes('installed')) {
  console.error('Module install did not confirm success');
  process.exit(1);
}
console.log('\nSuiteCRM setup complete.');
