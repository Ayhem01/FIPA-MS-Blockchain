const { Web3 } = require('web3');
const fs = require('fs');
const path = require('path');
const solc = require('solc');

class Web3Service {
    constructor() {
        this.web3 = null;
        this.contract = null;
        this.contractAddress = process.env.CONTRACT_ADDRESS;
        this.ganacheUrl = process.env.GANACHE_URL || 'http://127.0.0.1:7545';
        this.networkId = process.env.NETWORK_ID || '5777';
        // Reduced gas limit to work with Ganache default settings
        this.gasLimit = process.env.GAS_LIMIT || 6000000;
        // Much lower gas price for Ganache compatibility (20 gwei instead of 3000 gwei)
        this.gasPrice =  '20000000000'; // 20 gwei
    }

    async initialize() {
        try {
            // Connect to Ganache
            this.web3 = new Web3(new Web3.providers.HttpProvider(this.ganacheUrl));
            
            // Test connection
            await this.web3.eth.net.isListening();
            console.log('✅ Connected to Ganache successfully');
            
            // Load contract if address is provided
            if (this.contractAddress) {
                await this.loadContract();
                console.log('✅ Contract loaded with address:', this.contractAddress);
            } else {
                console.log('⚠️ No contract address provided in environment');
            }
            
            return true;
        } catch (error) {
            console.error('❌ Failed to connect to Ganache:', error.message);
            throw new Error(`Ganache connection failed: ${error.message}`);
        }
    }

    async loadContract() {
        try {
            const contractPath = path.join(__dirname, '../contracts/crmfipa.sol');
            const contractSource = fs.readFileSync(contractPath, 'utf8');
            
            // Compile contract with proper settings for Web3.js compatibility
            const input = {
                language: 'Solidity',
                sources: {
                    'crmfipa.sol': {
                        content: contractSource
                    }
                },
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200
                    },
                    outputSelection: {
                        '*': {
                            '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode']
                        }
                    },
                    // Ensure compatibility with Ganache
                    evmVersion: 'london'
                }
            };

            const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
            
            if (compiled.errors) {
                const errors = compiled.errors.filter(error => error.severity === 'error');
                if (errors.length > 0) {
                    throw new Error(`Contract compilation failed: ${errors.map(e => e.message).join(', ')}`);
                }
                // Log warnings but continue
                const warnings = compiled.errors.filter(error => error.severity === 'warning');
                if (warnings.length > 0) {
                    console.log('⚠️ Compilation warnings:', warnings.map(w => w.message).join(', '));
                }
            }

            const contractData = compiled.contracts['crmfipa.sol']['crmfipa'];
            if (!contractData) {
                throw new Error('Contract data not found in compilation output');
            }
            
            this.abi = contractData.abi;
            this.bytecode = contractData.evm.bytecode.object;
            
            // Load contract instance if deployed
            if (this.contractAddress) {
                this.contract = new this.web3.eth.Contract(this.abi, this.contractAddress);
                console.log('✅ Contract loaded successfully');
            }
            
            return { abi: this.abi, bytecode: this.bytecode };
        } catch (error) {
            console.error('❌ Failed to load contract:', error.message);
            throw error;
        }
    }

    async deployContract(privateKey) {
        try {
            // Ensure web3 is initialized
            if (!this.web3) {
                await this.initialize();
            }

            if (!this.abi || !this.bytecode) {
                await this.loadContract();
            }

            // Validate private key format
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }

            const account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
            this.web3.eth.accounts.wallet.add(account);
            console.log('🔑 Deploying contract from account:', account.address);

            // Get current network info
            const networkId = await this.web3.eth.net.getId();
            const gasPrice = await this.web3.eth.getGasPrice();
             //const gasPrice = '20000000000';

            
            console.log('🌐 Network ID:', networkId);
            console.log('⛽ Current gas price:', gasPrice);

            // Ensure bytecode has 0x prefix
            const deploymentBytecode = this.bytecode.startsWith('0x') ? this.bytecode : '0x' + this.bytecode;

            const contractInstance = new this.web3.eth.Contract(this.abi);
            
            const deployment = contractInstance.deploy({
                data: deploymentBytecode,
                arguments: []
            });

            // Estimate gas for deployment
            let estimatedGas;
            try {
                estimatedGas = await deployment.estimateGas({
                    from: account.address
                });
                console.log('⛽ Estimated gas:', estimatedGas);
                
                // Convert BigInt to number if needed and add 20% buffer
                //estimatedGas = Number(estimatedGas);
                //estimatedGas = Math.floor(estimatedGas * 1.2);
            } catch (gasError) {
                console.log('⚠️ Gas estimation failed, using default:', gasError.message);
                //estimatedGas = Number(this.gasLimit);
            }

            // Use the smaller of estimated gas or our limit
            const gasToUse = estimatedGas;
            console.log('⛽ Gas to use for deployment:', gasToUse);

            const deploymentOptions = {
                from: account.address,
                gas: estimatedGas.toString(),
                gasPrice: gasPrice.toString()
            };

            console.log('🚀 Deployment options:', deploymentOptions);

            const deployedContract = await deployment.send(deploymentOptions);

            this.contract = deployedContract;
            this.contractAddress = deployedContract.options.address;
            console.log('✅ Contract deployed successfully at:', this.contractAddress);
            console.log('📋 Transaction hash:', deployment);

            return {
                address: this.contractAddress,
                transactionHash: deployedContract.transactionHash,
                gasUsed: gasToUse
            };
        } catch (error) {
            console.error('❌ Contract deployment failed:', error.message);
            
            // Provide more specific error messages
            if (error.message.includes('invalid opcode')) {
                throw new Error('Contract deployment failed: Invalid opcode - check contract code and compiler version compatibility');
            } else if (error.message.includes('out of gas')) {
                throw new Error('Contract deployment failed: Out of gas - try increasing gas limit');
            } else if (error.message.includes('insufficient funds')) {
                throw new Error('Contract deployment failed: Insufficient funds in deployer account');
            }
            
            throw error;
        }
    }

    async getAccounts() {
        try {
            return await this.web3.eth.getAccounts();
        } catch (error) {
            console.error('❌ Failed to get accounts:', error.message);
            throw error;
        }
    }

    async getBalance(address) {
        try {
            const balance = await this.web3.eth.getBalance(address);
            return this.web3.utils.fromWei(balance, 'ether');
        } catch (error) {
            console.error('❌ Failed to get balance:', error.message);
            throw error;
        }
    }

 
    async sendTransaction(method, params, fromAddress, privateKey) {
        try {
            if (!this.contract) {
                throw new Error('Contract not loaded');
            }

            // Normalisation clé privée
            if (!privateKey || typeof privateKey !== 'string') {
                throw new Error('Private key is required');
            }
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }

            const account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
            this.web3.eth.accounts.wallet.add(account);

            if (!this.contract.methods[method]) {
                throw new Error(`Contract method not found: ${method}`);
            }

            // Construire l'appel + ABI
            const txMethod = this.contract.methods[method](...(params || []));
            const data = txMethod.encodeABI();

            // Estimer le gas avec buffer
            let gas = 300000;
            try {
                const est = await txMethod.estimateGas({ from: account.address });
                gas = Math.ceil(Number(est) * 1.2);
            } catch (e) {
                console.log('⚠️ Gas estimation failed, fallback 300000:', e.message);
            }

            const gasPrice = (await this.web3.eth.getGasPrice()).toString();
            const chainId = await this.web3.eth.getChainId().catch(() => 1337);
            const nonce = await this.web3.eth.getTransactionCount(account.address, 'pending');

            const tx = {
                to: this.contract.options.address,
                data,
                gas,
                gasPrice,
                chainId,
                nonce
            };

            // Signer + envoyer
            const signed = await this.web3.eth.accounts.signTransaction(tx, privateKey);
            if (!signed.rawTransaction) {
                throw new Error('Failed to sign transaction');
            }

            const receipt = await this.web3.eth.sendSignedTransaction(signed.rawTransaction);

            console.log(`✅ Tx mined for ${method}:`, {
                hash: receipt.transactionHash,
                block: receipt.blockNumber,
                status: receipt.status
            });

            return receipt; // transactionHash, blockNumber, status, logs...
        } catch (error) {
            console.error(`❌ Transaction failed for ${method}:`, error.message);
            throw error;
        }
    }


    async callMethod(method, params) {
        try {
            if (!this.contract) {
                throw new Error('Contract not loaded');
            }

            const result = await this.contract.methods[method](...params).call();
            console.log(`✅ Method call successful for ${method}:`,params, result);
            return result;
        } catch (error) {
            console.error(`❌ Method call failed for ${method}:`, error.message);
            throw error;
        }
    }

    async getContractEvents(eventName, fromBlock = 0, toBlock = 'latest') {
        try {
            if (!this.contract) {
                throw new Error('Contract not loaded');
            }

            const events = await this.contract.getPastEvents(eventName, {
                fromBlock,
                toBlock
            });

            return events;
        } catch (error) {
            console.error(`❌ Failed to get events for ${eventName}:`, error.message);
            throw error;
        }
    }

    getContractABI() {
        return this.abi;
    }

    getContractAddress() {
        return this.contractAddress;
    }

    isConnected() {
        return this.web3 !== null && this.web3.currentProvider.connected;
    }
}

module.exports = new Web3Service();