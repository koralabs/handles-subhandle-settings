import assert from "node:assert/strict";
import fs from "fs";
import * as helios from '@koralabs/helios'
import { ContractTester, Test, getAddressAtDerivation, convertJsontoCbor } from './contractTesting';
import { SubHandleSettingsFixtures, rootHandleName } from "./sub_handle_settings_fixtures";
helios.config.set({ IS_TESTNET: false, AUTO_SET_VALIDITY_RANGE: true });

const runTests = async (file: string) => {
    const contractFile = fs.readFileSync(file).toString();
    const program = helios.Program.new(contractFile);
    const contract = program.compile();
    const walletAddress = await getAddressAtDerivation(0);
    const tester = new ContractTester(walletAddress);
    // Keep the local contract tests offline; ContractTester.init fetches remote protocol params.
    tester.networkParams = new helios.NetworkParams(
        (helios as typeof helios & { rawNetworkEmulatorParams: object }).rawNetworkEmulatorParams
    );

    const migrateRedeemer = await convertJsontoCbor({constructor_1: [rootHandleName]});
    const createFixtures = async (migrate = false, ownerSignatureRequired = false) => {
        const fixtures = new SubHandleSettingsFixtures(contract.validatorHash);
        fixtures.shSettings[6] = ownerSignatureRequired ? 1 : 0;
        await fixtures.initialize();
        if (migrate) {
            fixtures.redeemer = helios.UplcData.fromCbor(migrateRedeemer);
        }
        return fixtures;
    };

    await Promise.all([
        // UPDATE_SETTINGS
        tester.test("UPDATE_SETTINGS", "Owner signed, settings load", new Test(program, () => createFixtures())),
        tester.test("UPDATE_SETTINGS", "Owner didn't sign", new Test(program, async () => {
            const fixtures = await createFixtures();
            fixtures.signatories = fixtures.signatories?.slice(0, 1);
            return fixtures;
        }), false, "Missing root handle owner signature"),
        tester.test("UPDATE_SETTINGS", "Admin settings reference input missing", new Test(program, async () => {
            const fixtures = await createFixtures();
            fixtures.refInputs = [];
            return fixtures;
        }), false, "AdminSettings reference input missing"),
        tester.test("UPDATE_SETTINGS", "Owner settings output missing", new Test(program, async () => {
            const fixtures = await createFixtures();
            const settingsInput = fixtures.inputs![1];
            // Remove the input token too, so balancing cannot return it in a change output.
            fixtures.inputs![1] = new helios.TxInput(settingsInput.outputId, new helios.TxOutput(
                fixtures.scriptAddress,
                new helios.Value(BigInt(200000000)),
                helios.Datum.inline(helios.UplcData.fromCbor(fixtures.shSettingsCbor))
            ));
            fixtures.outputs = fixtures.outputs?.slice(0, 1);
            return fixtures;
        }), false, "Owner settings output missing"),
        tester.test("UPDATE_SETTINGS", "Owner settings sent to unapproved contract", new Test(program, async () => {
            const fixtures = await createFixtures();
            const settingsOutput = fixtures.outputs![1];
            fixtures.outputs![1] = new helios.TxOutput(
                helios.Address.fromHash(helios.ValidatorHash.fromHex("00".repeat(28))),
                settingsOutput.value,
                settingsOutput.datum
            );
            return fixtures;
        }), false, "Contract not found in valid contracts list"),
        tester.test("UPDATE_SETTINGS", "Owner token missing from inputs", new Test(program, async () => {
            const fixtures = await createFixtures();
            // Keep assets balanced so rejection comes from the validator's owner-token check.
            fixtures.inputs = fixtures.inputs?.slice(1);
            fixtures.outputs = fixtures.outputs?.slice(1);
            return fixtures;
        }), false, "Owner's handle missing from inputs"),

        // MIGRATE
        tester.test("MIGRATE", "Admin signed, settings load", new Test(program, () => createFixtures(true))),
        tester.test("MIGRATE", "Owner sig required, owner signed", new Test(program, () => createFixtures(true, true))),
        tester.test("MIGRATE", "Owner sig required, didn't sign", new Test(program, async () => {
            const fixtures = await createFixtures(true, true);
            fixtures.signatories = fixtures.signatories?.slice(0, 1);
            return fixtures;
        }), false, "Missing root handle owner signature"),
        tester.test("MIGRATE", "Admin didn't sign, owner signed", new Test(program, async () => {
            const fixtures = await createFixtures(true);
            fixtures.signatories = fixtures.signatories?.slice(1);
            return fixtures;
        }), false, "Required admin signer(s) not present"),
    ]);
    tester.displayStats();
    assert.equal(tester.failCount, 0, `${tester.failCount} contract scenarios failed`);
};

await runTests('./subh.helios');
