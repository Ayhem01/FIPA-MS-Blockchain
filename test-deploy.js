const web3Service = require('./services/web3Service');

async function testDeployment() {
    try {
        console.log('🧪 Testing contract deployment...');
        
        // Initialize Web3 service
        await web3Service.initialize();
        console.log('✅ Web3 service initialized');
        
        // Load and compile contract
        const contractData = await web3Service.loadContract();
        console.log('✅ Contract compiled successfully');
        console.log('📝 ABI functions count:', contractData.abi.length);
        console.log('💾 Bytecode length:', contractData.bytecode.length);
        
        // Get Ganache accounts for testing
        const accounts = await web3Service.getAccounts();
        if (accounts.length === 0) {
            throw new Error('No accounts available in Ganache');
        }
        
        console.log('🔍 Available accounts:', accounts.length);
        console.log('💰 Using account:', accounts[0]);
        
        // Check account balance
        const balance = await web3Service.getBalance(accounts[0]);
        console.log('💰 Account balance:', balance, 'ETH');
        
        if (parseFloat(balance) < 1) {
            console.log('⚠️ Warning: Low account balance, deployment might fail');
        }
        
        // For testing, we'll use the first account's private key
        // Note: In Ganache, you can get the private key from the UI
        console.log('🔑 Please provide a private key from Ganache to test deployment');
        console.log('📋 You can find private keys in Ganache GUI under "Accounts" tab');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run the test
testDeployment();