import fs from "fs";
import * as helios from '@koralabs/helios'
import { ContractTester, Test, getAddressAtDerivation, convertJsontoCbor, getNewFakeUtxoId } from './contractTesting';
import { SubHandleSettingsFixtures, rootHandleName, rootOwnerKeyHex } from "./sub_handle_settings_fixtures";
import { AssetNameLabel } from "@koralabs/kora-labs-common";
helios.config.set({ IS_TESTNET: false, AUTO_SET_VALIDITY_RANGE: true });


// BURN (labeled-root teardown, decentralized-minting docs/spec/root-burn-with-labels.md).
// HANDLE_POLICY and DEMI_POLICY are rebound to two distinct always-satisfied timelock native scripts so the test
// tx can really burn under either policy (including cross-pollinated pairs).
// Invariant: the 001 (legacy or DeMi) leaves the contract only by being burned together with its root's 222
// (legacy or DeMi), and the spent UTxO carries nothing else that could escape. Each DENY removes one condition.
const legacyPolicy = helios.NativeScript.fromJson({ type: "after", slot: 0 });
const demiPolicy = helios.NativeScript.fromJson({ type: "after", slot: 1 });
type PolicyName = "legacy" | "demi";
const policyOf = (p: PolicyName) => (p === "legacy" ? legacyPolicy : demiPolicy);
const burnHandleHex = (label: string, name: string) => `${label}${Buffer.from(name).toString("hex")}`;

class BurnTest extends Test {
    burns: [PolicyName, string, bigint][];
    constructor(program: any, fixtures: () => Promise<any>, burns: [PolicyName, string, bigint][]) {
        super(program, fixtures);
        this.burns = burns;
    }
    async build() {
        const tx = await super.build();
        // The timelock policies are satisfied only with an explicit lower validity bound.
        tx.validFrom(new Date(Date.now() - 60_000));
        for (const policy of ["legacy", "demi"] as PolicyName[]) {
            const tokens = this.burns.filter(([p]) => p === policy).map(([, name, qty]) => [name, qty]);
            if (tokens.length === 0) continue;
            tx.attachScript(policyOf(policy));
            tx.mintTokens(policyOf(policy).mintingPolicyHash, tokens, null);
        }
        return tx;
    }
}

type BurnOpts = { handle?: string; extraAsset?: boolean; keep001?: boolean; attackerOwns?: string; labelPolicy?: PolicyName; rootPolicy?: PolicyName };

const burnFixture = async (validatorHash: any, opts: BurnOpts = {}) => {
    const labelPolicy = policyOf(opts.labelPolicy ?? "legacy").mintingPolicyHash.hex;
    const rootPolicy = policyOf(opts.rootPolicy ?? "legacy").mintingPolicyHash.hex;
    const owner = await getAddressAtDerivation(0);
    const script = helios.Address.fromHash(validatorHash);
    const label = burnHandleHex(AssetNameLabel.LBL_001, rootHandleName);
    const root222 = burnHandleHex(AssetNameLabel.LBL_222, rootHandleName);
    const spentAssets: [string, number][] = [[label, 1]];
    if (opts.extraAsset) spentAssets.push([burnHandleHex(AssetNameLabel.LBL_001, "other_root"), 1]);
    const redeemerCbor = await convertJsontoCbor({ constructor_2: [opts.handle ?? rootHandleName] });
    // The wallet side: the root's 222, plus (attack case) another root's 222 + 001 the signer owns outright.
    const walletAssets = new Map<string, [string, number][]>([[rootPolicy, [[root222, 1]]]]);
    if (opts.attackerOwns) {
        walletAssets.get(rootPolicy)!.push([burnHandleHex(AssetNameLabel.LBL_222, opts.attackerOwns), 1], [burnHandleHex(AssetNameLabel.LBL_001, opts.attackerOwns), 1]);
    }
    const keptAssets = new Map<string, [string, number][]>();
    const keep = (policy: string, name: string) => keptAssets.set(policy, [...(keptAssets.get(policy) ?? []), [name, 1]]);
    // keep001 / attack: this root's 001 walks out to the signer instead of being burned; the attack also keeps its 222.
    if (opts.keep001 || opts.attackerOwns) keep(labelPolicy, label);
    if (opts.attackerOwns) keep(rootPolicy, root222);
    return {
        inputs: [
            new helios.TxInput(new helios.TxOutputId(getNewFakeUtxoId()), new helios.TxOutput(owner,
                new helios.Value(BigInt(5000000), new helios.Assets([...walletAssets.entries()])))),
            new helios.TxInput(new helios.TxOutputId(getNewFakeUtxoId()), new helios.TxOutput(script,
                new helios.Value(BigInt(5000000), new helios.Assets([[labelPolicy, spentAssets]])),
                helios.Datum.inline(new helios.IntData(BigInt(0)))))
        ],
        refInputs: [],
        outputs: [new helios.TxOutput(owner, keptAssets.size
            ? new helios.Value(BigInt(2000000), new helios.Assets([...keptAssets.entries()]))
            : new helios.Value(BigInt(2000000)))],
        signatories: [rootOwnerKeyHex],
        redeemer: helios.UplcData.fromCbor(redeemerCbor),
        collateral: new helios.TxInput(new helios.TxOutputId(getNewFakeUtxoId()), new helios.TxOutput(owner, new helios.Value(BigInt(10000000))))
    };
};

const runBurnTests = async (file: string, tester: ContractTester) => {
    const program = helios.Program.new(fs.readFileSync(file).toString());
    program.parameters = { HANDLE_POLICY: legacyPolicy.mintingPolicyHash, DEMI_POLICY: demiPolicy.mintingPolicyHash };
    const validatorHash = program.compile().validatorHash;
    const r222 = burnHandleHex(AssetNameLabel.LBL_222, rootHandleName);
    const r001 = burnHandleHex(AssetNameLabel.LBL_001, rootHandleName);
    const o222 = burnHandleHex(AssetNameLabel.LBL_222, "other_root");
    const o001 = burnHandleHex(AssetNameLabel.LBL_001, "other_root");
    const t = (name: string, opts: BurnOpts, burns: [PolicyName, string, bigint][], approve = true, msg?: string) =>
        tester.test("BURN", name, new BurnTest(program, () => burnFixture(validatorHash, opts), burns), approve, msg);
    await Promise.all([
        t("legacy 001 and legacy 222 burned together", {}, [["legacy", r222, -1n], ["legacy", r001, -1n]]),
        t("DeMi 001 and DeMi 222 burned together", { labelPolicy: "demi", rootPolicy: "demi" }, [["demi", r222, -1n], ["demi", r001, -1n]]),
        t("legacy 001 with a DeMi 222 (cross-pollinated)", { labelPolicy: "legacy", rootPolicy: "demi" }, [["demi", r222, -1n], ["legacy", r001, -1n]]),
        t("DeMi 001 with a legacy 222 (cross-pollinated)", { labelPolicy: "demi", rootPolicy: "legacy" }, [["legacy", r222, -1n], ["demi", r001, -1n]]),
        t("root 222 not burned", {}, [["legacy", r001, -1n]], false, "Root 222 not burned"),
        t("DeMi root 222 not burned", { labelPolicy: "demi", rootPolicy: "demi" }, [["demi", r001, -1n]], false, "Root 222 not burned"),
        t("001 re-output instead of burned", { keep001: true }, [["legacy", r222, -1n]], false, "001 not burned"),
        t("DeMi 001 re-output instead of burned", { labelPolicy: "demi", rootPolicy: "demi", keep001: true }, [["demi", r222, -1n]], false, "001 not burned"),
        t("spent UTxO carries another asset", { extraAsset: true }, [["legacy", r222, -1n], ["legacy", r001, -1n]], false, "Spent UTxO must hold exactly this root's 001"),
        t("redeemer names a different root", { handle: "other_root", attackerOwns: "other_root" }, [["legacy", o222, -1n], ["legacy", o001, -1n]], false, "Spent UTxO must hold exactly this root's 001"),
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