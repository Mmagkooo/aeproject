import utils from '../aeproject-utils';
import * as fs from 'fs';
import * as loggerServices from '../aeproject-logger';
import nodeConfig from '../aeproject-config';
import { KeyPair, DeployedContract, Info, TxInfo, Client, ContractInstance, Network } from "./contractTypes";

const logStoreService = loggerServices.history;
let ttl = 100;
const opts = {
    ttl: ttl
};

let client: Client;
let contract: string;
let instances: Array<ContractInstance>;
let instancesMap = {};

logStoreService.initHistoryRecord();

function getContractName(contract): string {
    let rgx = /contract\s([a-zA-Z0-9]+)\s=/g;
    var match = rgx.exec(contract);

    return match[1];
}

async function getTxInfo(txHash): Promise<TxInfo> {
    let result;
    try {
        result = await client.getTxInfo(txHash)
    } catch (error) {
        let info = {
            gasUsed: 0,
            gasPrice: 0
        };

        return info;
    }
    return result;
}

export class Deployer {
    name: string;
    network: Network;
    compilerUrl: string;
    keypair: any;

    /**
     * 
     * @param {string} network 
     * @param {any} keypairOrSecret
     * @param {string} compilerUrl
     */

    constructor(network: string = "local", keypairOrSecret: object = utils.config.keypair, compilerUrl: string = "", networkId: string) {
        this.network = utils.getNetwork(network, networkId);
        this.compilerUrl = utils.getCompiler(network, compilerUrl);

        if (utils.isKeyPair(keypairOrSecret)) {
            this.keypair = keypairOrSecret;
            return
        }

        if (typeof keypairOrSecret === 'string' || keypairOrSecret instanceof String) {
            this.keypair = {
                publicKey: utils.generatePublicKeyFromSecretKey(keypairOrSecret),
                secretKey: keypairOrSecret
            }
            return
        }

        throw new Error("Incorrect keypair or secret key passed")
    }

    /**
     * 
     * @param {string} path 
     */

    async readFile(path: string): Promise<string> {
        return fs.readFileSync(path, "utf-8")
    }

    /**
     * Deploy command
     * @deploy
     * @param {string} contractPath - Relative path to the contract
     * @param {Array} initState - Initial arguments that will be passed to init function.
     * @param {object} options - Initial options that will be passed to init function.
     */
    async deploy(contractPath: string, initState: Array<string | number> = [], options: object = opts): Promise<DeployedContract> {

        this.network.compilerUrl = this.compilerUrl;

        client = await utils.getClient(this.network, this.keypair);
        contract = await this.readFile(contractPath);

        let contractInstance: ContractInstance;
        let deployedContract: DeployedContract;

        let contractFileName: Array<string | number>;
        let txInfo: TxInfo;

        let error: string;
        let isSuccess: boolean = true;
        let info: Info = {
            deployerType: this.constructor.name,
            publicKey: this.keypair.publicKey,
            nameOrLabel: getContractName(contract),
            status: false,
            networkId: this.network.networkId
        }

        try {
            contractInstance = await client.getContractInstance(contract);
            deployedContract = await contractInstance.deploy(initState, options);

            // extract smart contract's functions info, process it and generate function that would be assigned to deployed contract's instance
            await generateInstancesWithWallets(this.network, deployedContract.address);
            let additionalFuncs = addSpendFuncToContractInstance(contractInstance.methods, client);
            let contractInstanceWrapperFuncs = await generateFunctionsFromSmartContract(additionalFuncs);

            deployedContract = addSmartContractFunctions(deployedContract, contractInstanceWrapperFuncs);

            let regex = new RegExp(/[\w]+.aes$/);
            contractFileName = regex.exec(contractPath);
            txInfo = await getTxInfo(deployedContract.transaction);

            if (deployedContract && deployedContract.transaction) {

                info.transactionHash = deployedContract.transaction;
                info.gasPrice = txInfo.gasPrice;
                info.gasUsed = txInfo.gasUsed;
                info.result = deployedContract.address;
                info.status = true;

                console.log(`===== Contract: ${contractFileName} has been deployed at ${deployedContract.address} =====`);
            }

        } catch (e) {

            isSuccess = false;
            error = e;
            info.error = e.message;
            info.initState = initState;
            info.options = JSON.stringify(options);

            if (e.rawTx) {
                info.rawTx = e.rawTx;
                info.verifiedTx = await e.verifyTx(e.rawTx);

                printTxNetworkInfo(info, this.network);
            }
        }

        logStoreService.logAction(info);

        if (!isSuccess) {
            throw new Error(error);
        }

        return deployedContract;

        function addSmartContractFunctions(deployedContract: DeployedContract, contractInstanceWrapperFuncs): DeployedContract {
            let newInstanceWithAddedAdditionalFunctionality = Object.assign(contractInstanceWrapperFuncs, deployedContract);
            return newInstanceWithAddedAdditionalFunctionality;
        }
    }
}

async function generateInstancesWithWallets(network: Network, contractAddress) {
    instances = [];
    for (let wallet in nodeConfig.defaultWallets) {
        let currentClient: Client = await utils.getClient(network, nodeConfig.defaultWallets[wallet]);
        let contractInstance: ContractInstance = await currentClient.getContractInstance(contract, { contractAddress });
        instances.push(contractInstance)
        instancesMap[nodeConfig.defaultWallets[wallet].publicKey] = contractInstance
    }
}

async function generateFunctionsFromSmartContract(contractFunctions: Object): Promise<Object> {

    contractFunctions['from'] = async function (userWallet: any) {
        let walletToPass = userWallet

        if (walletToPass.secretKey) {
            walletToPass = walletToPass.secretKey
        }
        const keyPair: KeyPair = await utils.generateKeyPairFromSecretKey(walletToPass);

        // iteration of origin deployed instance
        // when we create new 'client', it does not have deployed tx info and additional functions like 'spend'
        // if function or property is missing from new 'client' we assigned it
        for (let funcName in contractFunctions) {

            if (!instancesMap[keyPair.publicKey].methods[funcName]) {
                instancesMap[keyPair.publicKey].methods[funcName] = contractFunctions[funcName];
            }
        }

        return instancesMap[keyPair.publicKey].methods
    }

    return contractFunctions;
}

function addSpendFuncToContractInstance(contractFunctions: Object, client: Client) {

    contractFunctions['spend'] = async function (amount: number, to: string) {
        return client.spend(amount, to);
    }

    return contractFunctions;
}

function printTxNetworkInfo(info: Info, network: Network) {
    console.log('[INFO] raw Tx:');
    console.log(info.rawTx);
    console.log('[INFO] verified Tx:');
    console.log(info.verifiedTx);
    console.log('[INFO] network');
    console.log(network);
    console.log();
}

