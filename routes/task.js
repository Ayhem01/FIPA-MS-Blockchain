const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// API key security for non-GET
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const expected = process.env.API_KEY;
  if (!expected) return next();
  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (provided !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
});

// Helpers
const toUint = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
};

function mapTaskStatus(s) {
  if (s === undefined || s === null) return null;
  const v = String(s).trim().toLowerCase();
  if (v === '0' || v === 'notstarted') return 0;
  if (v === '1' || v === 'inprogress') return 1;
  if (v === '2' || v === 'completed') return 2;
  if (v === '3' || v === 'deferred') return 3;
  if (v === '4' || v === 'waiting') return 4;
  return null;
}
function taskStatusLabel(n) {
  switch (Number(n)) {
    case 0: return 'NotStarted';
    case 1: return 'InProgress';
    case 2: return 'Completed';
    case 3: return 'Deferred';
    case 4: return 'Waiting';
    default: return 'Unknown';
  }
}

async function ensureContractReady() {
  if (!web3Service.web3) await web3Service.initialize();
  await web3Service.loadContract();
  if (!web3Service.contract) throw new Error('Contract not loaded');
}
async function getAccountFromPk(pkRaw) {
  const pk = (pkRaw || '').trim();
  const hex = pk.startsWith('0x') ? pk : `0x${pk}`;
  return web3Service.web3.eth.accounts.privateKeyToAccount(hex);
}
async function ensureOwnerAccount(account) {
  const owner = await web3Service.callMethod('owner', []);
  if (String(owner).toLowerCase() !== account.address.toLowerCase()) {
    throw new Error('Only owner');
  }
}
async function getTaskStruct(id) {
  try {
    const t = await web3Service.callMethod('tasks', [id]);
    if (t && Number(t.id) > 0) return t;
  } catch {}
  return null;
}

// Index
router.get('/', (_req, res) => {
  res.json({
    success: true,
    route: 'task',
    endpoints: [
      'POST   /api/task',
      'GET    /api/task/all',
      'GET    /api/task/:taskId',
      'PUT    /api/task/:taskId',
      'PUT    /api/task/:taskId/status',
      'DELETE /api/task/:taskId'
    ]
  });
});

// Create Task (createTask)
router.post('/', async (req, res) => {
  try {
    const {
      title = '',
      description = '',
      status,
      entityId,
      entityType = '',
      privateKey: pkIn
    } = req.body || {};

    const st = mapTaskStatus(status ?? 'NotStarted');
    const entId = toUint(entityId);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (!title) return res.status(400).json({ success: false, error: 'title requis' });
    if (st === null) return res.status(400).json({ success: false, error: 'status invalide (NotStarted|InProgress|Completed|Deferred|Waiting ou 0..4)' });
    if (entId === null) return res.status(400).json({ success: false, error: 'entityId invalide' });
    if (!entityType) return res.status(400).json({ success: false, error: 'entityType requis' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    // Simulation
    try {
      await web3Service.contract.methods
        .createTask(title, description, st, entId, entityType)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    // Tx
    const receipt = await web3Service.sendTransaction(
      'createTask',
      [title, description, st, entId, entityType],
      null,
      privateKey
    );

    let taskId = null;
    if (receipt.events?.TaskCreated?.returnValues?.id) {
      taskId = receipt.events.TaskCreated.returnValues.id.toString();
    } else if (receipt.events?.TaskCreated?.returnValues?.['0']) {
      taskId = receipt.events.TaskCreated.returnValues['0'].toString();
    }

    res.json({
      success: true,
      data: {
        taskId,
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber),
        gasUsed: receipt.gasUsed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all tasks (place before dynamic route)
router.get('/all', async (_req, res) => {
  try {
    await ensureContractReady();
    const ids = await web3Service.callMethod('getAllTasks', []);
    const seen = new Set();
    const unique = [];
    for (const id of ids) {
      const k = String(id);
      if (!seen.has(k)) { seen.add(k); unique.push(id); }
    }
    const tasks = [];
    for (const id of unique) {
      try {
        const t = await getTaskStruct(id);
        if (t) {
          tasks.push({
            id: t.id?.toString?.() ?? String(id),
            title: t.title || '',
            description: t.description || '',
            status: t.status?.toString?.() ?? '0',
            statusLabel: taskStatusLabel(t.status),
            entityId: t.entityId?.toString?.() ?? '0',
            entityType: t.entityType || '',
            createdAt: t.createdAt?.toString?.() ?? '',
            createdBy: t.createdBy || ''
          });
        }
      } catch (e) {
        console.error('Task fetch error', String(id), e.message);
      }
    }
    tasks.sort((a, b) => Number(a.id) - Number(b.id));
    res.json({ success: true, data: { count: tasks.length, tasks } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get one task
router.get('/:taskId', async (req, res) => {
  try {
    const idNum = toUint(req.params.taskId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'taskId invalide' });

    await ensureContractReady();
    const t = await getTaskStruct(idNum);
    if (!t) return res.status(404).json({ success: false, error: 'Task introuvable' });

    res.json({
      success: true,
      data: {
        id: t.id?.toString?.() ?? String(idNum),
        title: t.title || '',
        description: t.description || '',
        status: t.status?.toString?.() ?? '0',
        statusLabel: taskStatusLabel(t.status),
        entityId: t.entityId?.toString?.() ?? '0',
        entityType: t.entityType || '',
        createdAt: t.createdAt?.toString?.() ?? '',
        createdBy: t.createdBy || ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update task (updateTask: title, description, status)
router.put('/:taskId', async (req, res) => {
  try {
    const idNum = toUint(req.params.taskId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'taskId invalide' });

    const { title, description, status, statut, privateKey: pkIn } = req.body || {};
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await getTaskStruct(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Task introuvable' });

    const newTitle = (title ?? current.title ?? '').toString();
    const newDesc = (description ?? current.description ?? '').toString();
    const statusInput = statut ?? status;
    const newStatus = statusInput !== undefined ? mapTaskStatus(statusInput) : Number(current.status);

    if (!newTitle) return res.status(400).json({ success: false, error: 'title requis' });
    if (newStatus === null || !Number.isFinite(newStatus)) return res.status(400).json({ success: false, error: 'status invalide' });

    // Simulation
    try {
      await web3Service.contract.methods
        .updateTask(idNum, newTitle, newDesc, newStatus)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction(
      'updateTask',
      [idNum, newTitle, newDesc, newStatus],
      null,
      privateKey
    );

    res.json({
      success: true,
      data: {
        taskId: String(idNum),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update only status (fallback via updateTask)
router.put('/:taskId/status', async (req, res) => {
  try {
    const idNum = toUint(req.params.taskId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'taskId invalide' });

    const { status, statut, privateKey: pkIn } = req.body || {};
    const st = mapTaskStatus(statut ?? status);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (st === null) return res.status(400).json({ success: false, error: 'status invalide (NotStarted|InProgress|Completed|Deferred|Waiting ou 0..4)' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await getTaskStruct(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Task introuvable' });

    const title = current.title || '';
    const desc = current.description || '';

    // Simulation
    try {
      await web3Service.contract.methods
        .updateTask(idNum, title, desc, st)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction(
      'updateTask',
      [idNum, title, desc, st],
      null,
      privateKey
    );

    res.json({
      success: true,
      data: {
        taskId: String(idNum),
        status: st.toString(),
        statusLabel: taskStatusLabel(st),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete task
router.delete('/:taskId', async (req, res) => {
  try {
    const idNum = toUint(req.params.taskId);
    const privateKey = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (idNum === null) return res.status(400).json({ success: false, error: 'taskId invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await getTaskStruct(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Task introuvable' });

    // Simulation
    try {
      await web3Service.contract.methods.deleteTask(idNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction('deleteTask', [idNum], null, privateKey);

    res.json({
      success: true,
      data: {
        taskId: String(idNum),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;