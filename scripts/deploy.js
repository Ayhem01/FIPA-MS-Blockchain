const web3Service = require('../services/web3Service');
const fs = require('fs');
const path = require('path');

async function deployContract() {
    try {
        console.log('🚀 Starting contract deployment...');
        
        // Initialize Web3 connection
        await web3Service.initialize();
        console.log('✅ Web3 connection established');
        
        // Get deployer private key from environment or command line
        const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.argv[2];
        
        if (!privateKey) {
            console.error('❌ Private key not provided. Set DEPLOYER_PRIVATE_KEY environment variable or pass as argument');
            process.exit(1);
        }
        
        console.log('📝 Compiling and deploying contract...');
        
        // Deploy the contract
        const result = await web3Service.deployContract(privateKey);
        
        console.log('✅ Contract deployed successfully!');
        console.log('📄 Contract Address:', result.address);
        console.log('🔗 Transaction Hash:', result.transactionHash);
        
        // Update .env file with contract address
        const envPath = path.join(__dirname, '../.env');
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        // Replace or add CONTRACT_ADDRESS
        if (envContent.includes('CONTRACT_ADDRESS=')) {
            envContent = envContent.replace(/CONTRACT_ADDRESS=.*/g, `CONTRACT_ADDRESS=${result.address}`);
        } else {
            envContent += `\nCONTRACT_ADDRESS=${result.address}`;
        }
        
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Updated .env file with contract address');
        
        // Save ABI to file
        const abiPath = path.join(__dirname, '../contracts/crmfipa-abi.json');
        fs.writeFileSync(abiPath, JSON.stringify(result.abi, null, 2));
        console.log('✅ Saved ABI to contracts/crmfipa-abi.json');
        
        // Save deployment info
        const deploymentInfo = {
            contractAddress: result.address,
            transactionHash: result.transactionHash,
            deployedAt: new Date().toISOString(),
            network: {
                url: process.env.GANACHE_URL,
                networkId: process.env.NETWORK_ID
            }
        };
        
        const deploymentPath = path.join(__dirname, '../contracts/deployment.json');
        fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
        console.log('✅ Saved deployment info to contracts/deployment.json');
        
        console.log('\n🎉 Deployment completed successfully!');
        console.log('🔧 You can now start the microservice with: npm run dev');
        
        return result;
        
    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
    }
}

// Run deployment if this script is executed directly
if (require.main === module) {
    deployContract();
}

module.exports = { deployContract };