import fs from "fs";
import * as helios from '@koralabs/helios'
import { Fixtures, ContractTester, Test, getAddressAtDerivation, convertJsontoCbor } from '@koralabs/kora-labs-contract-testing';
import { SubHandleSettingsFixtures, rootHandleName } from "./sub_handle_settings_fixtures";
helios.config.set({ IS_TESTNET: false, AUTO_SET_VALIDITY_RANGE: true });

const runTests = async (file: string) => {
    let contractFile = fs.readFileSync(file).toString();
    const program = helios.Program.new(contractFile);
    const contract = program.compile();

    let fixtures = await (new SubHandleSettingsFixtures(contract.validatorHash).initialize());
    const walletAddress = await getAddressAtDerivation(0);
    const tester = new ContractTester(walletAddress);
    await tester.init();
    
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
            (migrateFixtures as SubHandleSettingsFixtures).shSettings[5] = true;
            await migrateFixtures.initialize();
            migrateFixtures.signatories = migrateFixtures.signatories?.slice(0,1);
            return migrateFixtures;
        }), false, "Missing root handle owner signature"),
    ]
    ).then(() => {tester.displayStats()});
}

(async()=> {
    await runTests('./subhandle_settings.helios')
})();