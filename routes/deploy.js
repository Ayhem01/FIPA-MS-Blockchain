const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// Deploy contract
router.post('/contract', async (req, res) => {
    try {
        // const { privateKey } = req.body;
        const privateKey=process.env.DEPLOYER_PRIVATE_KEY;
        if (!privateKey) {
            return res.status(400).json({
                success: false,
                error: 'privateKey is required for deployment'
            });
        }

        const result = await web3Service.deployContract(privateKey);
        console.log('Deployment result:', result);
        
        res.json({
            success: true,
            data: {
                message: 'Contract deployed successfully',
                contractAddress: result.address,
                transactionHash: result.transactionHash,
                abi: result.abi
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Load existing contract
router.post('/load', async (req, res) => {
    try {
        const { contractAddress } = req.body;
        
        if (!contractAddress) {
            return res.status(400).json({
                success: false,
                error: 'contractAddress is required'
            });
        }

        // Update environment variable
        process.env.CONTRACT_ADDRESS = contractAddress;
        web3Service.contractAddress = contractAddress;
        
        await web3Service.loadContract();
        
        res.json({
            success: true,
            data: {
                message: 'Contract loaded successfully',
                contractAddress: contractAddress,
                abi: web3Service.getContractABI()
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get deployment status
router.get('/status', async (req, res) => {
    try {
        const contractAddress = web3Service.getContractAddress();
        const isConnected = web3Service.isConnected();
        const accounts = await web3Service.getAccounts();
        
        res.json({
            success: true,
            data: {
                isConnected,
                contractAddress,
                isContractLoaded: !!contractAddress,
                availableAccounts: accounts.length,
                ganacheUrl: process.env.GANACHE_URL
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;