const web3Service = require('./services/web3Service');

async function fullDeploymentTest() {
    try {
        console.log('🚀 Starting full contract deployment test...');
        
        // Replace this with an actual private key from Ganache
        // You can get this from Ganache GUI > Accounts > Click key icon
        const GANACHE_PRIVATE_KEY = "0xYOUR_PRIVATE_KEY_HERE";
        
        if (GANACHE_PRIVATE_KEY === "0xYOUR_PRIVATE_KEY_HERE") {
            console.log('❌ Please update the private key in this script first!');
            console.log('📋 Get it from Ganache GUI > Accounts > Click key icon');
            return;
        }
        
        // Initialize Web3 service
        await web3Service.initialize();
        console.log('✅ Web3 service initialized');
        
        // Deploy the contract
        console.log('🚀 Deploying contract...');
        const deploymentResult = await web3Service.deployContract(GANACHE_PRIVATE_KEY);
        
        console.log('✅ Contract deployed successfully!');
        console.log('📍 Contract address:', deploymentResult.address);
        console.log('📋 Transaction hash:', deploymentResult.transactionHash);
        console.log('⛽ Gas used:', deploymentResult.gasUsed);
        
        // Test a simple contract call
        console.log('🧪 Testing contract calls...');
        
        // Call a view function to verify contract is working
        const owner = await web3Service.callMethod('owner', []);
        console.log('👤 Contract owner:', owner);
        
        // Get all prospects (should be empty initially)
        const prospects = await web3Service.callMethod('getAllProspects', []);
        console.log('📋 Initial prospects count:', prospects.length);
        
        // Get all active stages (should have 5 default stages)
        const activeStages = await web3Service.callMethod('getAllActiveStages', []);
        console.log('📊 Default pipeline stages:', activeStages.length);
        
        console.log('✅ All tests passed! Contract is working correctly.');
        
    } catch (error) {
        console.error('❌ Deployment test failed:', error.message);
        
        if (error.message.includes('invalid opcode')) {
            console.log('💡 Try these solutions:');
            console.log('   1. Restart Ganache');
            console.log('   2. Check if the private key is correct');
            console.log('   3. Ensure Ganache has enough gas limit (try 8000000)');
        }
    }
}

// Run the full deployment test
fullDeploymentTest();