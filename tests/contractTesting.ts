import * as helios from "@koralabs/helios";
import { HANDLE_POLICIES } from "@koralabs/kora-labs-common";
import { Buffer } from "node:buffer";
import * as https from "node:https";

helios.config.set({ IS_TESTNET: false, AUTO_SET_VALIDITY_RANGE: true });

const NETWORK = (process.env.NETWORK ?? "preview").toLowerCase();
const DERIVATION_PUB_KEY_HASHES: Record<number, string> = {
    0: "b32d73a127613965d793ad6f7455a9373fb17ae604a24378f4aba455",
    10: "f12b88068cd1f7f454c217826bfd8d58e215e499f74ddb26392cf08c",
};

const Color = {
    Reset: "\x1b[0m",
    FgRed: "\x1b[31m",
    FgGreen: "\x1b[32m",
    FgBlue: "\x1b[34m",
    FgYellow: "\x1b[33m",
};

export const handlesPolicy = helios.MintingPolicyHash.fromHex(HANDLE_POLICIES.getActivePolicy(NETWORK) ?? "");

let utxoIndex = 0;
export const getNewFakeUtxoId = () => {
    return `0000000000000000000000000000000000000000000000000000000000000001#${utxoIndex++}`;
};

export const getAddressAtDerivation = async (derivation = 0) => {
    const pubKeyHash = DERIVATION_PUB_KEY_HASHES[derivation];
    if (!pubKeyHash) {
        throw new Error(`Unsupported test derivation ${derivation}`);
    }

    return helios.Address.fromHash(new helios.PubKeyHash([...Buffer.from(pubKeyHash, "hex")]));
};

export class Fixtures {
    inputs?: any[];
    refInputs?: any[];
    outputs?: any[];
    signatories?: any[];
    minted?: any;
    redeemer?: any;
    collateral?: any;
}

export const convertJsontoCbor = (json: unknown): Promise<string> => {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(json);
        const options = {
            hostname: "preview.api.handle.me",
            port: 443,
            path: "/datum?from=json&to=plutus_data_cbor&numeric_keys=true",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": postData.length,
                "Accept": "text/plain",
                "User-Agent": process.env.KORA_USER_AGENT ?? "kora-handles-subhandle-settings-tests",
                "api-key": `${process.env.HANDLE_ME_API_KEY ?? ""}`,
            },
        };

        let data = "";
        const req = https.request(options, (res) => {
            res.on("data", (d) => { data += d; });
            res.on("end", () => { resolve(data); });
        });
        req.on("error", reject);
        req.write(postData);
        req.end();
    });
};

export class Test {
    tx: any;
    script: any;
    inputs?: any[];
    refInputs?: any[];
    outputs?: any[];
    signatories?: any[];
    minted?: any;
    redeemer?: any;
    collateral?: any;
    fixture?: () => Promise<Fixtures> | Fixtures;

    constructor(script: any, fixtures?: () => Promise<Fixtures> | Fixtures, setupTx?: () => any, optimizedCompile = false) {
        this.script = script.compile(optimizedCompile);
        this.tx = setupTx ? setupTx() : new helios.Tx();
        this.fixture = fixtures;
    }

    reset(_fixtures: Fixtures) { }

    async build() {
        if (this.fixture) {
            const fixture = await this.fixture();
            this.inputs = fixture.inputs;
            this.refInputs = fixture.refInputs;
            this.outputs = fixture.outputs;
            this.signatories = fixture.signatories;
            this.minted = fixture.minted;
            this.redeemer = fixture.redeemer;
            this.collateral = fixture.collateral;
        }
        if (this.inputs) {
            this.inputs.forEach((input, index) => this.tx.addInput(input, (index == ((this.inputs?.length ?? 0) - 1) && this.redeemer) ? this.redeemer : undefined));
        }
        if (this.refInputs) {
            this.refInputs.forEach((input) => this.tx.addRefInput(input));
        }
        this.tx.attachScript(this.script);
        if (this.minted) {
            this.tx.mintTokens(this.script.mintingPolicyHash, this.minted, this.redeemer ?? null);
        }
        if (this.outputs) {
            this.outputs.forEach((output) => this.tx.addOutput(output));
        }
        if (this.signatories) {
            this.signatories.forEach((signer) => this.tx.addSigner(signer));
        }
        if (this.collateral) {
            this.tx.addCollateral(this.collateral);
        }
        return this.tx;
    }
}

export class ContractTester {
    networkParams: any = {};
    successCount = 0;
    failCount = 0;
    testCount = 0;
    testName?: string;
    groupName?: string;
    changeAddress: any;
    verbose = false;

    constructor(changeAddress: any, verbose = false) {
        if (!changeAddress) {
            throw new Error("changeAddress is required");
        }
        this.changeAddress = changeAddress;
        this.verbose = verbose;
    }

    async init(groupName?: string, testName?: string) {
        this.groupName = groupName;
        this.testName = testName;
        this.networkParams = new helios.NetworkParams(await fetch("https://d1t0d7c2nekuk0.cloudfront.net/mainnet.json").then((response) => response.json()));
    }

    cleanTestName() {
        return `${this.groupName}${this.testName}`.replace(/[^a-z0-9]/gi, "");
    }

    async test(group: string, name: string, test: Test, shouldApprove = true, message?: string) {
        if (this.groupName == null || group == this.groupName) {
            if (this.testName == null || name == this.testName) {
                this.testCount++;
                const tx = await test.build();
                try {
                    await tx.finalize(this.networkParams ?? {}, this.changeAddress);
                    this.logTest(tx, shouldApprove, group, name, message);
                }
                catch (error) {
                    if (this.verbose) {
                        console.log(JSON.stringify(tx.dump()));
                    }
                    this.logTest(tx, shouldApprove, group, name, message, error);
                }
            }
        }
    }

    logTest(tx: any, shouldApprove: boolean, group: string, test: string, message?: string, error?: unknown) {
        const errorMessage = error instanceof Error ? error.message : "";
        const prints = errorMessage.split(/\r|\n/ig).filter((m) => m.startsWith("INFO"));
        const hasPrintStatements = prints.length > 0;
        const assertion = (shouldApprove && !error) || (!shouldApprove && error && (!message || errorMessage.includes(message)));
        const textColor = assertion ? Color.FgGreen : Color.FgRed;
        if (!assertion || hasPrintStatements) {
            console.log(`${textColor}------------------------------${Color.Reset}`);
        }
        const mem = `mem:${tx.witnesses.redeemers.reduce((n: bigint, r: any) => { return n + r.memCost; }, BigInt(0))}`;
        const cpu = `cpu:${tx.witnesses.redeemers.reduce((n: bigint, r: any) => { return n + r.cpuCost; }, BigInt(0))}`;
        const size = `size:${tx.body.toCborHex().length / 2}`;
        console.log(`${textColor}*${assertion ? "success" : "failure"}* - ${(shouldApprove ? "APPROVE" : "DENY").padEnd(7)} - ${group.padEnd(25)} '${test}'${Color.Reset} ( ${mem}, ${cpu}, ${size} )`);
        if (hasPrintStatements) {
            console.log(`   ${Color.FgYellow}PRINT STATEMENTS:${Color.Reset}\n   ${prints.join("\n   ")}`);
        }
        if (assertion) {
            this.successCount++;
        }
        else {
            this.failCount++;
            console.log(`   ${Color.FgYellow}ERROR:${Color.Reset}`);
            if (error && !hasPrintStatements) {
                console.log(error);
            }
            console.log("\n");
            console.log(`   ${Color.FgYellow}EXPECTED:\n   ${Color.FgBlue}${message ? message : "success"}${Color.Reset}`);
            console.log(`   ${Color.FgYellow}RECEIVED:`);
            if (prints.length > 0) {
                console.log(`   ${Color.FgRed}${prints[prints.length - 1]}${Color.Reset}`);
            }
            else {
                console.log(`   ${Color.FgRed}${shouldApprove ? "tx denied" : "tx approved"}${Color.Reset}`);
            }
        }
        if (!assertion || hasPrintStatements) {
            console.log(`${textColor}------------------------------${Color.Reset}`);
        }
    }

    displayStats() {
        console.log(`${Color.FgBlue}** SUMMARY **${Color.Reset}`);
        console.log(`${Color.FgBlue}${this.testCount.toString().padStart(5)} total tests${Color.Reset}`);
        if (this.successCount > 0) {
            console.log(`${Color.FgGreen}${this.successCount.toString().padStart(5)} successful${Color.Reset}`);
        }
        if (this.failCount > 0) {
            console.log(`${Color.FgRed}${this.failCount.toString().padStart(5)} failed${Color.Reset}`);
        }
    }

    getTotals() {
        return { testCount: this.testCount, successCount: this.successCount, failCount: this.failCount };
    }
}
