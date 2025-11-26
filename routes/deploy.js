const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// Deploy contract
router.post('/contract', async (req, res) => {
    try {
        await web3Service.initialize();

        // Prevent redeploy if a valid contract already exists at CONTRACT_ADDRESS
        const existing = process.env.CONTRACT_ADDRESS;
        // if (existing && /^0x[a-fA-F0-9]{40}$/.test(existing)) {
        //     const code = await web3Service.web3.eth.getCode(existing);
            // if (code && code !== '0x') {
                // return res.status(400).json({
                //     success: false,
                //     error: `Contract already deployed at ${existing}`
                // });
            // }
        // }

        // Compile first to get ABI and verify EIP-170 size before sending
        const { abi, bytecode } = await web3Service.loadContract();
        const byteLen = (bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode).length / 2;
        if (byteLen > 24576) {
            return res.status(400).json({
                success: false,
                error: `Bytecode too large (${byteLen} bytes > 24576). Enable optimizer/viaIR or split the contract.`
            });
        }

        // Use DEPLOYER_PRIVATE_KEY from env by default
        const privateKey = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
        if (!privateKey) {
            return res.status(400).json({
                success: false,
                error: 'privateKey is required for deployment'
            });
        }

        const result = await web3Service.deployContract(privateKey);

        res.json({
            success: true,
            data: {
                message: 'Contract deployed successfully',
                contractAddress: result.address,
                transactionHash: result.transactionHash,
                gasUsed: result.gasUsed,
                abi: result.abi || abi
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

        if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
            return res.status(400).json({
                success: false,
                error: 'Valid contractAddress is required'
            });
        }

        await web3Service.initialize();

        const code = await web3Service.web3.eth.getCode(contractAddress);
        if (!code || code === '0x') {
            return res.status(404).json({ success: false, error: 'No contract code at given address' });
        }

        process.env.CONTRACT_ADDRESS = contractAddress;
        web3Service.contractAddress = contractAddress;

        await web3Service.loadContract();

        res.json({
            success: true,
            data: {
                message: 'Contract loaded successfully',
                contractAddress,
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
router.get('/status', async (_req, res) => {
    try {
        const contractAddress = web3Service.getContractAddress();
        const isConnected = web3Service.isConnected();
        let accounts = [];
        if (isConnected) {
            try { accounts = await web3Service.getAccounts(); } catch {}
        }

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