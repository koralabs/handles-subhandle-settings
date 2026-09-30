import fs from "fs";
import * as helios from '@koralabs/helios'
import { ContractTester, Test, getAddressAtDerivation, convertJsontoCbor, getNewFakeUtxoId } from './contractTesting';
import { SubHandleSettingsFixtures, rootHandleName, rootOwnerKeyHex } from "./sub_handle_settings_fixtures";
import { AssetNameLabel } from "@koralabs/kora-labs-common";
helios.config.set({ IS_TESTNET: false, AUTO_SET_VALIDITY_RANGE: true });


// BURN (labeled-root teardown, decentralized-minting docs/spec/root-burn-with-labels.md).
// HANDLE_POLICY is rebound to an always-satisfied timelock native script so the test tx can really burn the 222/001.
// Invariant: the 001 leaves the contract only by being burned together with its root's 222, and the spent
// UTxO carries nothing else that could escape. Each DENY case removes exactly one of those conditions.
const nativePolicy = helios.NativeScript.fromJson({ type: "after", slot: 0 });
const burnHandleHex = (label: string, name: string) => `${label}${Buffer.from(name).toString("hex")}`;

class BurnTest extends Test {
    burns: [string, bigint][];
    constructor(program: any, fixtures: () => Promise<any>, burns: [string, bigint][]) {
        super(program, fixtures);
        this.burns = burns;
    }
    async build() {
        const tx = await super.build();
        // The timelock policy is satisfied only with an explicit lower validity bound.
        tx.validFrom(new Date(Date.now() - 60_000));
        tx.attachScript(nativePolicy);
        tx.mintTokens(nativePolicy.mintingPolicyHash, this.burns.map(([name, qty]) => [name, qty]), null);
        return tx;
    }
}

const burnFixture = async (validatorHash: any, opts: { handle?: string; extraAsset?: boolean; keep001?: boolean; attackerOwns?: string } = {}) => {
    const policy = nativePolicy.mintingPolicyHash.hex;
    const owner = await getAddressAtDerivation(0);
    const script = helios.Address.fromHash(validatorHash);
    const label = burnHandleHex(AssetNameLabel.LBL_001, rootHandleName);
    const spentAssets: [string, number][] = [[label, 1]];
    if (opts.extraAsset) spentAssets.push([burnHandleHex(AssetNameLabel.LBL_001, "other_root"), 1]);
    const redeemerCbor = await convertJsontoCbor({ constructor_2: [opts.handle ?? rootHandleName] });
    // The wallet side: the root's 222, plus (attack case) another root's 222 + 001 the signer owns outright.
    const walletAssets: [string, number][] = [[burnHandleHex(AssetNameLabel.LBL_222, rootHandleName), 1]];
    if (opts.attackerOwns) walletAssets.push([burnHandleHex(AssetNameLabel.LBL_222, opts.attackerOwns), 1], [burnHandleHex(AssetNameLabel.LBL_001, opts.attackerOwns), 1]);
    return {
        inputs: [
            new helios.TxInput(new helios.TxOutputId(getNewFakeUtxoId()), new helios.TxOutput(owner,
                new helios.Value(BigInt(5000000), new helios.Assets([[policy, walletAssets]])))),
            new helios.TxInput(new helios.TxOutputId(getNewFakeUtxoId()), new helios.TxOutput(script,
                new helios.Value(BigInt(5000000), new helios.Assets([[policy, spentAssets]])),
                helios.Datum.inline(new helios.IntData(BigInt(0)))))
        ],
        refInputs: [],
        // keep001 / attack: this root's 001 walks out to the signer instead of being burned; attack also keeps its 222.
        outputs: opts.attackerOwns
            ? [new helios.TxOutput(owner, new helios.Value(BigInt(2000000), new helios.Assets([[policy, [[label, 1], [burnHandleHex(AssetNameLabel.LBL_222, rootHandleName), 1]]]])))]
            : opts.keep001
                ? [new helios.TxOutput(owner, new helios.Value(BigInt(2000000), new helios.Assets([[policy, [[label, 1]]]])))]
                : [new helios.TxOutput(owner, new helios.Value(BigInt(2000000)))],
        signatories: [rootOwnerKeyHex],
        redeemer: helios.UplcData.fromCbor(redeemerCbor),
        collateral: new helios.TxInput(new helios.TxOutputId(getNewFakeUtxoId()), new helios.TxOutput(owner, new helios.Value(BigInt(10000000))))
    };
};

const runBurnTests = async (file: string, tester: ContractTester) => {
    const program = helios.Program.new(fs.readFileSync(file).toString());
    program.parameters = { HANDLE_POLICY: nativePolicy.mintingPolicyHash };
    const validatorHash = program.compile().validatorHash;
    const r222 = burnHandleHex(AssetNameLabel.LBL_222, rootHandleName);
    const r001 = burnHandleHex(AssetNameLabel.LBL_001, rootHandleName);
    await Promise.all([
        tester.test("BURN", "001 and root 222 burned together", new BurnTest(program, () => burnFixture(validatorHash), [[r222, -1n], [r001, -1n]])),
        tester.test("BURN", "root 222 not burned", new BurnTest(program, () => burnFixture(validatorHash), [[r001, -1n]]), false, "Root 222 not burned"),
        tester.test("BURN", "001 re-output instead of burned", new BurnTest(program, () => burnFixture(validatorHash, { keep001: true }), [[r222, -1n]]), false, "001 not burned"),
        tester.test("BURN", "spent UTxO carries another asset", new BurnTest(program, () => burnFixture(validatorHash, { extraAsset: true }), [[r222, -1n], [r001, -1n]]), false, "Spent UTxO must hold exactly this root's 001"),
        tester.test("BURN", "redeemer names a different root", new BurnTest(program, () => burnFixture(validatorHash, { handle: "other_root", attackerOwns: "other_root" }), [[burnHandleHex(AssetNameLabel.LBL_222, "other_root"), -1n], [burnHandleHex(AssetNameLabel.LBL_001, "other_root"), -1n]]), false, "Spent UTxO must hold exactly this root's 001"),
    ]);
};

const runTests = async (file: string) => {
    let contractFile = fs.readFileSync(file).toString();
    const program = helios.Program.new(contractFile);
    const contract = program.compile();

    let fixtures = await (new SubHandleSettingsFixtures(contract.validatorHash).initialize());
    const walletAddress = await getAddressAtDerivation(0);
    const tester = new ContractTester(walletAddress);
    // Keep the local contract tests offline; ContractTester.init fetches remote protocol params.
    tester.networkParams = new helios.NetworkParams(
        (helios as typeof helios & { rawNetworkEmulatorParams: object }).rawNetworkEmulatorParams
    );
    
    const migrateRedeemer = await convertJsontoCbor({constructor_1: [rootHandleName]});
    const migrateFixtures = await (new SubHandleSettingsFixtures(contract.validatorHash).initialize()) 
    migrateFixtures.redeemer = helios.UplcData.fromCbor(migrateRedeemer);
    
    Promise.all([
        // UPDATE_SETTINGS
        tester.test("UPDATE_SETTINGS", "Owner signed, settings load", new Test(program, () => fixtures)),
        tester.test("UPDATE_SETTINGS", "Owner didn't sign", new Test(program, async () => {
            const testFixtures = await (new SubHandleSettingsFixtures(contract.validatorHash).initialize()) 
            testFixtures.signatories = testFixtures.signatories?.slice(0,1)
            return testFixtures;
        }), false, "Missing root handle owner signature"),

        // MIGRATE
        tester.test("MIGRATE", "Admin signed, settings load", new Test(program, async () => migrateFixtures)),
        tester.test("MIGRATE", "Owner sig required, didn't sign", new Test(program, async () => {
            const migrateFixtures = new SubHandleSettingsFixtures(contract.validatorHash);
            (migrateFixtures as SubHandleSettingsFixtures).shSettings[5] = 1;
            await migrateFixtures.initialize();
            migrateFixtures.signatories = migrateFixtures.signatories?.slice(0,1);
            return migrateFixtures;
        }), false, "Missing root handle owner signature"),
    ]
    ).then(() => runBurnTests(file, tester)).then(() => {
        tester.displayStats();
        // A failed contract test must fail the run (CI relies on the exit code).
        if (tester.failCount > 0) process.exitCode = 1;
    });
}

(async()=> {
    await runTests('./subh.helios')
})();