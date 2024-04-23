import fs from "fs";
import * as helios from '@hyperionbt/helios'
import { Fixtures, ContractTester, Test } from '@koralabs/kora-labs-contract-testing';
helios.config.set({ IS_TESTNET: false, AUTO_SET_VALIDITY_RANGE: true });

const runTests = async (file: string) => {
    let contractFile = fs.readFileSync(file).toString();
    const program = helios.Program.new(contractFile);
    //const contract = program.compile();

    let fixtures = new Fixtures();
    await fixtures.initialize();

    const tester = new ContractTester(fixtures.walletAddress);
    await tester.init();
    
    Promise.all([
        // SHOULD APPROVE
        tester.test("GROUP", "example test 1", new Test(program, () => {
            //custom setup of default fixtures
            return fixtures;
        })),

        // SHOULD DENY
        tester.test("GROUP", "example test 2", new Test(program, () => fixtures, () => {
            // custom tx setup
            return new helios.Tx();
        }), false, "expected error message"),
    ]
    ).then(() => {tester.displayStats()});
}

(async()=> {
    await runTests('./subhandle_settings.helios')
})();