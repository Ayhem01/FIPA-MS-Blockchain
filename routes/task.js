const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// Create a new task
router.post('/', async (req, res) => {
    try {
        const { 
            prospectId, 
            stageId, 
            title, 
            description, 
            start, 
            end, 
            taskType, 
            priority, 
            assigneeId, 
            privateKey 
        } = req.body;
        
        if (!prospectId || !stageId || !title || !description || !start || !end || 
            taskType === undefined || priority === undefined || !assigneeId || !privateKey) {
            return res.status(400).json({
                success: false,
                error: 'All task fields (prospectId, stageId, title, description, start, end, taskType, priority, assigneeId) and privateKey are required'
            });
        }

        const result = await web3Service.sendTransaction(
            'createTask',
            [prospectId, stageId, title, description, start, end, taskType, priority, assigneeId],
            null,
            privateKey
        );

        res.json({
            success: true,
            data: {
                prospectId,
                stageId,
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

// Get task details
router.get('/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        
        const task = await web3Service.callMethod('tasks', [taskId]);
        
        res.json({
            success: true,
            data: {
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
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update task status
router.put('/:taskId/status', async (req, res) => {
    try {
        const { taskId } = req.params;
        const { status, privateKey } = req.body;
        
        if (status === undefined || !privateKey) {
            return res.status(400).json({
                success: false,
                error: 'status and privateKey are required'
            });
        }

        const result = await web3Service.sendTransaction(
            'updateTaskStatus',
            [taskId, status],
            null,
            privateKey
        );

        res.json({
            success: true,
            data: {
                taskId,
                status,
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

// Get pipeline stages
router.get('/stages/all', async (req, res) => {
    try {
        const stageIds = await web3Service.callMethod('getAllActiveStages', []);
        
        const stages = [];
        for (const id of stageIds) {
            try {
                const stage = await web3Service.callMethod('pipelineStages', [id]);
                stages.push({
                    id: stage.id,
                    name: stage.name,
                    order: stage.order,
                    isFinal: stage.isFinal,
                    isActive: stage.isActive
                });
            } catch (err) {
                console.error(`Error fetching stage ${id}:`, err.message);
            }
        }
        
        // Sort by order
        stages.sort((a, b) => parseInt(a.order) - parseInt(b.order));
        
        res.json({
            success: true,
            data: {
                count: stages.length,
                stages
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get stage details
router.get('/stages/:stageId', async (req, res) => {
    try {
        const { stageId } = req.params;
        
        const stage = await web3Service.callMethod('pipelineStages', [stageId]);
        
        res.json({
            success: true,
            data: {
                id: stage.id,
                name: stage.name,
                order: stage.order,
                isFinal: stage.isFinal,
                isActive: stage.isActive
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create new pipeline stage
router.post('/stages', async (req, res) => {
    try {
        const { name, order, isFinal, isActive, privateKey } = req.body;
        
        if (!name || order === undefined || isFinal === undefined || 
            isActive === undefined || !privateKey) {
            return res.status(400).json({
                success: false,
                error: 'name, order, isFinal, isActive, and privateKey are required'
            });
        }

        const result = await web3Service.sendTransaction(
            'createPipelineStage',
            [name, order, isFinal, isActive],
            null,
            privateKey
        );

        res.json({
            success: true,
            data: {
                name,
                order,
                isFinal,
                isActive,
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

// Task type enum mapping
router.get('/types', (req, res) => {
    res.json({
        success: true,
        data: {
            taskTypes: {
                0: 'Call',
                1: 'Meeting', 
                2: 'EmailJournal',
                3: 'Note',
                4: 'Todo'
            },
            taskStatuses: {
                0: 'NotStarted',
                1: 'InProgress',
                2: 'Completed',
                3: 'Deferred',
                4: 'Waiting'
            },
            taskPriorities: {
                0: 'Low',
                1: 'Medium',
                2: 'High',
                3: 'Urgent'
            },
            prospectStatuses: {
                0: 'Nouveau',
                1: 'EnCours',
                2: 'Qualifie',
                3: 'NonQualifie',
                4: 'Converti',
                5: 'Perdu'
            },
            inviterStatuses: {
                0: 'Pending',
                1: 'Accepted',
                2: 'Rejected'
            }
        }
    });
});

module.exports = router;