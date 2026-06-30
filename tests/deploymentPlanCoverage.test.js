import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSubhandleSettingsDeploymentPlan,
  discoverNextContractSubhandle,
  fetchLiveSubhandleSettingsDeploymentState,
} from '../deploymentPlan.js';

const desiredSettings = {
  valid_contracts: ['b026528c4d6cc77d4527f8ab794651d0aa3ef2dc06e4f5d7d36c3465'],
  admin_creds: ['0297c358427a84608418ef3501a41cd600cfa1361be2e28998ace35c'],
  virtual_price: 2000000,
  base_price: 5000000,
  buy_down_prices: [[1000000000, 10]],
  payment_address: '30195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66',
  expiry_duration: 31536000000,
  renewal_window: 31535700000,
};

const desiredState = {
  network: 'preview',
  contractSlug: 'subh',
  deploymentHandleSlug: 'subh',
  subhandleStrategy: { namespace: 'handlecontract' },
  assignedHandles: {
    settings: ['sh_settings'],
    scripts: ['subhsetcont_003'],
  },
  ignoredSettings: [],
  settings: {
    type: 'subhandle_settings',
    values: { sh_settings: desiredSettings },
  },
};

const previewDatum = '9f9f581cb026528c4d6cc77d4527f8ab794651d0aa3ef2dc06e4f5d7d36c3465581c0297c358427a84608418ef3501a41cd600cfa1361be2e28998ace35c581c020c5d23c38087ae006e01926cba57ff0022287f9e6fafeb891b77a0581cf8923bbf64b7b4409b56733c12406363faf40f51edb2be72fd4d2e09ff9f581cb026528c4d6cc77d4527f8ab794651d0aa3ef2dc06e4f5d7d36c3465581c0297c358427a84608418ef3501a41cd600cfa1361be2e28998ace35c581c020c5d23c38087ae006e01926cba57ff0022287f9e6fafeb891b77a0ff1a001e84801a004c4b409f9f1a3b9aca000aff9f1b00000002540be4001819ff9f1b0000000ba43b74001828ff9f1b000000174876e8001832ff9f1b000000746a5288001846ff9f1b000000e8d4a510001855ffff583930195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d661b0000000757b12c001b0000000757ac9820ff';

const okScriptResponse = () => new Response(JSON.stringify({
  validatorHash: 'ab'.repeat(28),
  handle: 'subhsetcont_003',
}), { status: 200 });

const okHandleResponse = () => new Response(JSON.stringify({ utxo: 'tx#0' }), { status: 200 });

const restoreEnv = (key, value) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

const writeDiscoverStub = (root, body) => {
  const commonDir = path.join(root, 'common');
  fs.mkdirSync(commonDir, { recursive: true });
  const stubPath = path.join(commonDir, 'discover_subhandles.py');
  fs.writeFileSync(stubPath, `#!/usr/bin/env python3\n${body}`, { mode: 0o755 });
  return stubPath;
};

test('fetches live deployment state from every Handles API base URL', async () => {
  const cases = [
    {
      network: 'preprod',
      expectedUrl: 'https://preprod.api.handle.me/scripts?latest=true&type=sub_handle_settings',
    },
    {
      network: 'mainnet',
      expectedUrl: 'https://api.handle.me/scripts?latest=true&type=sub_handle_settings',
    },
  ];

  for (const { network, expectedUrl } of cases) {
    const requests = [];
    const live = await fetchLiveSubhandleSettingsDeploymentState({
      network,
      scriptType: 'sub_handle_settings',
      userAgent: 'codex-test',
      fetchFn: async (url, init) => {
        requests.push({ url: String(url), headers: init?.headers });
        if (String(url).includes('/scripts?')) {
          return new Response(JSON.stringify({ scriptHash: 'cd'.repeat(28), handle: '' }), { status: 200 });
        }
        if (String(url).endsWith('/datum')) {
          return new Response(previewDatum, { status: 200 });
        }
        return new Response(JSON.stringify({ utxo: '' }), { status: 200 });
      },
    });

    assert.equal(requests[0].url, expectedUrl);
    assert.deepEqual(requests[0].headers, { 'User-Agent': 'codex-test' });
    assert.equal(live.currentScriptHash, 'cd'.repeat(28));
    assert.equal(live.currentSubhandle, null);
    assert.deepEqual(live.currentSettingsUtxoRefs, {});
  }
});

test('surfaces live deployment state fetch and payload failures', async () => {
  const cases = [
    {
      fetchFn: async () => new Response('unavailable', { status: 503 }),
      pattern: /failed to load live subhandle settings script: HTTP 503/,
    },
    {
      fetchFn: async () => new Response(JSON.stringify({ handle: 'subhsetcont_003' }), { status: 200 }),
      pattern: /missing validatorHash\/scriptHash/,
    },
    {
      fetchFn: async (url) => String(url).includes('/scripts?')
        ? okScriptResponse()
        : new Response('bad handle', { status: 500 }),
      pattern: /failed to load handle sh_settings: HTTP 500/,
    },
    {
      fetchFn: async (url) => {
        if (String(url).includes('/scripts?')) return okScriptResponse();
        if (String(url).endsWith('/datum')) return new Response('bad datum', { status: 404 });
        return okHandleResponse();
      },
      pattern: /failed to load datum for sh_settings: HTTP 404/,
    },
  ];

  for (const { fetchFn, pattern } of cases) {
    await assert.rejects(
      fetchLiveSubhandleSettingsDeploymentState({
        network: 'preview',
        scriptType: 'sub_handle_settings',
        userAgent: 'codex-test',
        fetchFn,
      }),
      pattern
    );
  }
});

test('builds a settings-only deployment plan that reuses the existing script handle', () => {
  const plan = buildSubhandleSettingsDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: 'ab'.repeat(28),
    live: {
      currentScriptHash: 'ab'.repeat(28),
      currentSubhandle: 'subhsetcont_003',
      settings: {
        sh_settings: {
          ...desiredSettings,
          base_price: 1,
        },
      },
    },
    nextSubhandle: null,
  });

  assert.equal(plan.driftType, 'settings_only');
  assert.equal(plan.summaryJson.contracts[0].subhandle.action, 'reuse');
  assert.equal(plan.summaryJson.contracts[0].subhandle.value, 'subhsetcont_003');
  assert.equal(plan.summaryJson.contracts[0].settings.diff_rows[0].current.base_price, 1);
  assert.deepEqual(
    plan.summaryJson.contracts[0].expected_post_deploy_state.assigned_handles.scripts,
    ['subhsetcont_003']
  );
});

test('requires a resolved SubHandle before rendering no-change deployment plans', () => {
  assert.throws(
    () => buildSubhandleSettingsDeploymentPlan({
      desired: desiredState,
      expectedScriptHash: 'ab'.repeat(28),
      live: {
        currentScriptHash: 'ab'.repeat(28),
        currentSubhandle: null,
        settings: desiredState.settings.values,
      },
      nextSubhandle: null,
    }),
    /deployment plan requires a resolved SubHandle/
  );
});

test('discovers SubHandles from ADAHANDLE_DEPLOYMENTS_PATH when no explicit helper is set', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-adahandle-root-'));
  writeDiscoverStub(tmpDir, `import sys
slug = sys.argv[sys.argv.index('--slug') + 1]
namespace = sys.argv[sys.argv.index('--namespace') + 1]
print(f'{slug}9@{namespace}')
`);
  const originalExplicit = process.env.DISCOVER_SUBHANDLES_PATH;
  const originalDeployRoot = process.env.ADAHANDLE_DEPLOYMENTS_PATH;
  delete process.env.DISCOVER_SUBHANDLES_PATH;
  process.env.ADAHANDLE_DEPLOYMENTS_PATH = tmpDir;
  try {
    const subhandle = await discoverNextContractSubhandle({
      network: 'preprod',
      deploymentHandleSlug: 'subh',
      namespace: 'handlecontract',
      currentSubhandle: 'subhsetcont_003',
      userAgent: 'codex-test',
    });
    assert.equal(subhandle, 'subh9@handlecontract');
  } finally {
    restoreEnv('DISCOVER_SUBHANDLES_PATH', originalExplicit);
    restoreEnv('ADAHANDLE_DEPLOYMENTS_PATH', originalDeployRoot);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reports missing canonical SubHandle discovery helper paths', async () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-missing-parent-'));
  const repoDir = path.join(parentDir, 'repo');
  fs.mkdirSync(repoDir);
  const originalExplicit = process.env.DISCOVER_SUBHANDLES_PATH;
  const originalDeployRoot = process.env.ADAHANDLE_DEPLOYMENTS_PATH;
  const originalCwd = process.cwd();
  delete process.env.DISCOVER_SUBHANDLES_PATH;
  delete process.env.ADAHANDLE_DEPLOYMENTS_PATH;
  process.chdir(repoDir);
  try {
    await assert.rejects(
      discoverNextContractSubhandle({
        network: 'preview',
        deploymentHandleSlug: 'subh',
        namespace: 'handlecontract',
        currentSubhandle: null,
        userAgent: 'codex-test',
      }),
      /discover_subhandles.py not found/
    );
  } finally {
    process.chdir(originalCwd);
    restoreEnv('DISCOVER_SUBHANDLES_PATH', originalExplicit);
    restoreEnv('ADAHANDLE_DEPLOYMENTS_PATH', originalDeployRoot);
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});
