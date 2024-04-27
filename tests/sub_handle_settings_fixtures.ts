import * as helios from "@hyperionbt/helios";
import { AssetNameLabel } from "@koralabs/kora-labs-common";
import { Fixtures, convertJsontoCbor, getAddressAtDerivation, getNewFakeUtxoId, handlesPolicy } from "@koralabs/kora-labs-contract-testing";

const rootHandleName = 'root_handle';
export const shAdminHandle = `${AssetNameLabel.LBL_222}${Buffer.from('sh_settings').toString('hex')}`;
export const rootHandle = `${AssetNameLabel.LBL_222}${Buffer.from(rootHandleName).toString('hex')}`;
export const shSettingsHandle = `${AssetNameLabel.LBL_001}${Buffer.from(rootHandleName).toString('hex')}`;
export const adminKeyHex = helios.PubKeyHash.fromHex((await getAddressAtDerivation(10)).pubKeyHash?.hex ?? '');
export const rootOwnerKeyHex = helios.PubKeyHash.fromHex((await getAddressAtDerivation(0)).pubKeyHash?.hex ?? '');

export class SubHandleSettingsFixtures extends Fixtures {
    adminSettings = [
        [],
        [],
        15000000,
        [[100000, 10]]
    ] as unknown as (string[] | number | number[][])[]
    adminSettingsCbor: string;
    shSettings = [
        [
            true,
            true,
            [[1, 20000000]],
            '',
            0
        ],
        [
            true,
            true,
            [[1, 20000000]],
            '',
            0
    ],
        10000000,
        100000000000,
        '',
        true
    ]
    shSettingsCbor: string;
    scriptAddress: helios.Address;
    validatorHash: helios.ValidatorHash;
    
    constructor(validatorHash: helios.ValidatorHash) {
        super();
        this.scriptAddress = helios.Address.fromHash(validatorHash);
        this.validatorHash = validatorHash;
    }

    async initialize(): Promise<Fixtures> {
        const redeemerCbor = await convertJsontoCbor({constructor_0: [rootHandleName]});
        this.redeemer = helios.UplcData.fromCbor(redeemerCbor);
        (this.adminSettings[0] as string[]).push(`0x${this.validatorHash.hex}`);
        (this.adminSettings[1] as string[]).push(`0x${adminKeyHex.hex}`);
        console.log(this.adminSettings);
        this.adminSettingsCbor = await convertJsontoCbor(this.adminSettings);
        console.log(this.adminSettingsCbor)
        this.shSettingsCbor = await convertJsontoCbor(this.shSettings);
        this.inputs = [
            new helios.TxInput(new helios.TxOutputId(getNewFakeUtxoId()), new helios.TxOutput(
                this.scriptAddress,
                new helios.Value(BigInt(200000000), new helios.Assets([[handlesPolicy.hex, [[shSettingsHandle, 1]]]])),
                helios.Datum.inline(helios.UplcData.fromCbor(this.shSettingsCbor))
            ))
        ];
        this.refInputs = [
            new helios.TxInput(new helios.TxOutputId(getNewFakeUtxoId()), new helios.TxOutput(
                await getAddressAtDerivation(0), 
                new helios.Value(BigInt(1), new helios.Assets([[handlesPolicy.hex, [[rootHandle, 1]]]])))),
            new helios.TxInput(new helios.TxOutputId(getNewFakeUtxoId()), new helios.TxOutput(
                await getAddressAtDerivation(0), 
                new helios.Value(BigInt(1), new helios.Assets([[handlesPolicy.hex, [[shAdminHandle, 1]]]])),
                helios.Datum.inline(helios.UplcData.fromCbor(this.adminSettingsCbor))))
        ];
        this.outputs = [
            new helios.TxOutput(
                this.scriptAddress, 
                new helios.Value(BigInt(1), new helios.Assets([[handlesPolicy.hex, [[shSettingsHandle, 1]]]])),
                helios.Datum.inline(helios.UplcData.fromCbor(this.shSettingsCbor)))
        ]
        this.signatories = [ adminKeyHex, rootOwnerKeyHex ]
        this.collateral = new helios.TxInput(new helios.TxOutputId(getNewFakeUtxoId()), new helios.TxOutput(
            await getAddressAtDerivation(0), 
            new helios.Value(BigInt(10000000))))
        return this;
    }
}