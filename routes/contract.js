const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// Initialize Web3 connection
router.get('/init', async (req, res) => {
    try {
        await web3Service.initialize();
        res.json({
            success: true,
            message: 'Web3 service initialized successfully',
            connected: web3Service.isConnected(),
            contractAddress: web3Service.getContractAddress()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get contract information
router.get('/info', async (req, res) => {
    try {
        const accounts = await web3Service.getAccounts();
        const contractAddress = web3Service.getContractAddress();
        const abi = web3Service.getContractABI();
        
        res.json({
            success: true,
            data: {
                contractAddress,
                accounts,
                connected: web3Service.isConnected(),
                abiLength: abi ? abi.length : 0
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get account balance
router.get('/balance/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const balance = await web3Service.getBalance(address);
        
        res.json({
            success: true,
            data: {
                address,
                balance: balance + ' ETH'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get contract events
router.get('/events/:eventName', async (req, res) => {
    try {
        const { eventName } = req.params;
        const { fromBlock = 0, toBlock = 'latest' } = req.query;
        
        const events = await web3Service.getContractEvents(eventName, fromBlock, toBlock);
        
        res.json({
            success: true,
            data: {
                eventName,
                events,
                count: events.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all events
router.get('/events', async (req, res) => {
    try {
        const { fromBlock = 0, toBlock = 'latest' } = req.query;
        
        const eventNames = [
            'InviterAdded',
            'InvitationAccepted', 
            'InvitationRejected',
            'ProspectCreated',
            'ProspectAdvanced',
            'ProspectConverted',
            'PipelineStageCreated',
            'TaskCreated',
            'TaskCompleted'
        ];
        
        const allEvents = {};
        for (const eventName of eventNames) {
            try {
                allEvents[eventName] = await web3Service.getContractEvents(eventName, fromBlock, toBlock);
            } catch (err) {
                allEvents[eventName] = [];
            }
        }
        
        res.json({
            success: true,
            data: allEvents
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;