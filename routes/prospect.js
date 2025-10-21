const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// Create a new prospect
router.post('/', async (req, res) => {
    try {
        const { name, responsiblePerson, privateKey } = req.body;
        
        if (!name || !responsiblePerson || !privateKey) {
            return res.status(400).json({
                success: false,
                error: 'name, responsiblePerson, and privateKey are required'
            });
        }

        const result = await web3Service.sendTransaction(
            'createProspect',
            [name, responsiblePerson],
            null,
            privateKey
        );

        res.json({
            success: true,
            data: {
                transactionHash: result.transactionHash,
                blockNumber: result.blockNumber,
                gasUsed: result.gasUsed
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get prospect details
router.get('/:prospectId', async (req, res) => {
    try {
        const { prospectId } = req.params;
        
        const prospect = await web3Service.callMethod('prospects', [prospectId]);
        
        res.json({
            success: true,
            data: {
                id: prospect.id,
                inviterId: prospect.inviterId,
                name: prospect.name,
                status: prospect.status,
                currentStageId: prospect.currentStageId,
                responsiblePerson: prospect.responsiblePerson,
                createdAt: prospect.createdAt,
                convertedAt: prospect.convertedAt,
                investorId: prospect.investorId,
                isPipelineCompleted: prospect.isPipelineCompleted
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all prospects
router.get('/', async (req, res) => {
    try {
        const prospectIds = await web3Service.callMethod('getAllProspects', []);
        
        const prospects = [];
        for (const id of prospectIds) {
            try {
                const prospect = await web3Service.callMethod('prospects', [id]);
                prospects.push({
                    id: prospect.id,
                    inviterId: prospect.inviterId,
                    name: prospect.name,
                    status: prospect.status,
                    currentStageId: prospect.currentStageId,
                    responsiblePerson: prospect.responsiblePerson,
                    createdAt: prospect.createdAt,
                    convertedAt: prospect.convertedAt,
                    investorId: prospect.investorId,
                    isPipelineCompleted: prospect.isPipelineCompleted
                });
            } catch (err) {
                console.error(`Error fetching prospect ${id}:`, err.message);
            }
        }
        
        res.json({
            success: true,
            data: {
                count: prospects.length,
                prospects
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Advance prospect to next stage
router.post('/:prospectId/advance', async (req, res) => {
    try {
        const { prospectId } = req.params;
        const { notes = '', privateKey } = req.body;
        
        if (!privateKey) {
            return res.status(400).json({
                success: false,
                error: 'privateKey is required'
            });
        }

        const result = await web3Service.sendTransaction(
            'advanceProspectToNextStage',
            [prospectId, notes],
            null,
            privateKey
        );

        res.json({
            success: true,
            data: {
                prospectId,
                transactionHash: result.transactionHash,
                blockNumber: result.blockNumber,
                gasUsed: result.gasUsed
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Convert prospect to investor
router.post('/:prospectId/convert', async (req, res) => {
    try {
        const { prospectId } = req.params;
        const { investorId, privateKey } = req.body;
        
        if (!investorId || !privateKey) {
            return res.status(400).json({
                success: false,
                error: 'investorId and privateKey are required'
            });
        }

        const result = await web3Service.sendTransaction(
            'convertProspectToInvestor',
            [prospectId, investorId],
            null,
            privateKey
        );

        res.json({
            success: true,
            data: {
                prospectId,
                investorId,
                transactionHash: result.transactionHash,
                blockNumber: result.blockNumber,
                gasUsed: result.gasUsed
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Check if prospect can be converted
router.get('/:prospectId/can-convert', async (req, res) => {
    try {
        const { prospectId } = req.params;
        
        const canConvert = await web3Service.callMethod('canConvertToInvestor', [prospectId]);
        
        res.json({
            success: true,
            data: {
                prospectId,
                canConvert
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get prospect progression percentage
router.get('/:prospectId/progress', async (req, res) => {
    try {
        const { prospectId } = req.params;
        
        const percentage = await web3Service.callMethod('calculateProgressionPercentage', [prospectId]);
        
        res.json({
            success: true,
            data: {
                prospectId,
                progressPercentage: percentage
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get prospect tasks
router.get('/:prospectId/tasks', async (req, res) => {
    try {
        const { prospectId } = req.params;
        
        const taskIds = await web3Service.callMethod('getProspectTasks', [prospectId]);
        
        const tasks = [];
        for (const taskId of taskIds) {
            try {
                const task = await web3Service.callMethod('tasks', [taskId]);
                tasks.push({
                    id: task.id,
                    title: task.title,
                    description: task.description,
                    start: task.start,
                    end: task.end,
                    taskType: task.taskType,
                    status: task.status,
                    priority: task.priority,
                    assigneeId: task.assigneeId,
                    entityId: task.entityId,
                    stageId: task.stageId
                });
            } catch (err) {
                console.error(`Error fetching task ${taskId}:`, err.message);
            }
        }
        
        res.json({
            success: true,
            data: {
                prospectId,
                count: tasks.length,
                tasks
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get prospect tasks for specific stage
router.get('/:prospectId/tasks/stage/:stageId', async (req, res) => {
    try {
        const { prospectId, stageId } = req.params;
        
        const taskIds = await web3Service.callMethod('getTasksForProspectStage', [prospectId, stageId]);
        
        const tasks = [];
        for (const taskId of taskIds) {
            try {
                const task = await web3Service.callMethod('tasks', [taskId]);
                tasks.push({
                    id: task.id,
                    title: task.title,
                    description: task.description,
                    start: task.start,
                    end: task.end,
                    taskType: task.taskType,
                    status: task.status,
                    priority: task.priority,
                    assigneeId: task.assigneeId,
                    entityId: task.entityId,
                    stageId: task.stageId
                });
            } catch (err) {
                console.error(`Error fetching task ${taskId}:`, err.message);
            }
        }
        
        res.json({
            success: true,
            data: {
                prospectId,
                stageId,
                count: tasks.length,
                tasks
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Set stage as final for specific prospect
router.post('/:prospectId/stage/:stageId/final', async (req, res) => {
    try {
        const { prospectId, stageId } = req.params;
        const { isFinal, privateKey } = req.body;
        
        if (typeof isFinal !== 'boolean' || !privateKey) {
            return res.status(400).json({
                success: false,
                error: 'isFinal (boolean) and privateKey are required'
            });
        }

        const result = await web3Service.sendTransaction(
            'setStageFinalForProspect',
            [prospectId, stageId, isFinal],
            null,
            privateKey
        );

        res.json({
            success: true,
            data: {
                prospectId,
                stageId,
                isFinal,
                transactionHash: result.transactionHash,
                blockNumber: result.blockNumber,
                gasUsed: result.gasUsed
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