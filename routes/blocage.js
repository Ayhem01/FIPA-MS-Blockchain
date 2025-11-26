const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// API key security for non-GET
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const expected = process.env.API_KEY;
  if (!expected) return next();
  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (provided !== expected) return res.status(401).json({ success: false, error: 'Unauthorized' });
  next();
});

const toUint = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
};

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
  try {
    const owner = await web3Service.callMethod('owner', []);
    if (String(owner).toLowerCase() !== account.address.toLowerCase()) {
      throw new Error('Only owner');
    }
  } catch {
    throw new Error('Owner check failed');
  }
}
async function fetchBlocage(id) {
  try {
    const b = await web3Service.callMethod('blocages', [id]);
    if (b && Number(b.id) > 0) return b;
  } catch {}
  return null;
}

// Index
router.get('/', (_req, res) => {
  res.json({
    success: true,
    route: 'blocage',
    endpoints: [
      'POST   /api/blocage',
      'GET    /api/blocage/all',
      'GET    /api/blocage/:blocageId',
      'PUT    /api/blocage/:blocageId',
      'PUT    /api/blocage/:blocageId/escalade',
      'PUT    /api/blocage/:blocageId/resolve',
      'DELETE /api/blocage/:blocageId'
    ]
  });
});

// Create (createBlocage avec assignedTo en uint)
router.post('/', async (req, res) => {
  try {
    const {
      name = '',
      description = '',
      status = '',
      priority,
      isBlocking,
      relatedEntityId,
      related_entity_id,
      relatedEntityType = '',
      related_entity_type = '',
      assignedToId,
      assigned_to_id,
      privateKey: pkIn
    } = req.body || {};

    const prio = toUint(priority);
    const blockFlag = Boolean(isBlocking);
    const relId = toUint(relatedEntityId ?? related_entity_id);
    const relType = (relatedEntityType || related_entity_type || '').toString();
    const assignedTo = toUint(assignedToId ?? assigned_to_id ?? 0);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (!name) return res.status(400).json({ success: false, error: 'name requis' });
    if (!status) return res.status(400).json({ success: false, error: 'status requis' });
    if (prio === null || prio > 255) return res.status(400).json({ success: false, error: 'priority invalide (0-255)' });
    if (relId === null) return res.status(400).json({ success: false, error: 'relatedEntityId invalide' });
    if (!relType) return res.status(400).json({ success: false, error: 'relatedEntityType requis' });
    if (assignedTo === null) return res.status(400).json({ success: false, error: 'assignedToId invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    // Simulation
    try {
      await web3Service.contract.methods
        .createBlocage(name, description, status, prio, blockFlag, relId, relType, assignedTo)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    // Tx
    const receipt = await web3Service.sendTransaction(
      'createBlocage',
      [name, description, status, prio, blockFlag, relId, relType, assignedTo],
      null,
      privateKey
    );

    let blocageId = null;
    if (receipt.events?.BlocageCreated?.returnValues?.id) {
      blocageId = receipt.events.BlocageCreated.returnValues.id.toString();
    } else if (receipt.events?.BlocageCreated?.returnValues?.['0']) {
      blocageId = receipt.events.BlocageCreated.returnValues['0'].toString();
    }

    res.json({
      success: true,
      data: {
        blocageId,
        assignedTo: String(assignedTo),
        transactionHash: receipt.transactionHash
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all (placer avant la route dynamique)
router.get('/all', async (_req, res) => {
  try {
    await ensureContractReady();
    const ids = await web3Service.callMethod('getAllBlocages', []);
    const seen = new Set();
    const unique = [];
    for (const id of ids) {
      const k = String(id);
      if (!seen.has(k)) { seen.add(k); unique.push(id); }
    }
    const blocages = [];
    for (const id of unique) {
      const b = await fetchBlocage(id);
      if (b) {
        blocages.push({
          id: b.id?.toString?.() ?? String(id),
          name: b.name || '',
          description: b.description || '',
          status: b.status || '',
          priority: b.priority?.toString?.() ?? '0',
          assignedTo: b.assignedTo?.toString?.() ?? '0',   // uint
          resolvedBy: b.resolvedBy?.toString?.() ?? '0',   // uint
          isBlocking: Boolean(b.isBlocking),
          relatedEntityId: b.relatedEntityId?.toString?.() ?? '0',
          relatedEntityType: b.relatedEntityType || ''
        });
      }
    }
    blocages.sort((a, b) => Number(a.id) - Number(b.id));
    res.json({ success: true, data: { count: blocages.length, blocages } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get one
router.get('/:blocageId', async (req, res) => {
  try {
    const idNum = toUint(req.params.blocageId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'blocageId invalide' });

    await ensureContractReady();
    const b = await fetchBlocage(idNum);
    if (!b) return res.status(404).json({ success: false, error: 'Blocage introuvable' });

    res.json({
      success: true,
      data: {
        id: b.id?.toString?.() ?? String(idNum),
        name: b.name || '',
        description: b.description || '',
        status: b.status || '',
        priority: b.priority?.toString?.() ?? '0',
        assignedTo: b.assignedTo?.toString?.() ?? '0',
        resolvedBy: b.resolvedBy?.toString?.() ?? '0',
        isBlocking: Boolean(b.isBlocking),
        relatedEntityId: b.relatedEntityId?.toString?.() ?? '0',
        relatedEntityType: b.relatedEntityType || ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update (updateBlocage)
router.put('/:blocageId', async (req, res) => {
  try {
    const idNum = toUint(req.params.blocageId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'blocageId invalide' });

    const { name, description, status, priority, isBlocking, privateKey: pkIn } = req.body || {};
    const prio = priority !== undefined ? toUint(priority) : null;
    const blockFlag = isBlocking !== undefined ? Boolean(isBlocking) : null;
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await fetchBlocage(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Blocage introuvable' });

    const newName = (name ?? current.name ?? '').toString();
    const newDesc = (description ?? current.description ?? '').toString();
    const newStatus = (status ?? current.status ?? '').toString();
    const newPriority = prio !== null ? prio : Number(current.priority);
    const newIsBlocking = blockFlag !== null ? blockFlag : Boolean(current.isBlocking);

    if (!newName) return res.status(400).json({ success: false, error: 'name requis' });
    if (!newStatus) return res.status(400).json({ success: false, error: 'status requis' });
    if (newPriority < 0 || newPriority > 255) return res.status(400).json({ success: false, error: 'priority doit être entre 0 et 255' });

    // Simulation
    try {
      await web3Service.contract.methods
        .updateBlocage(idNum, newName, newDesc, newStatus, newPriority, newIsBlocking)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction(
      'updateBlocage',
      [idNum, newName, newDesc, newStatus, newPriority, newIsBlocking],
      null,
      privateKey
    );

    res.json({ success: true, data: { blocageId: String(idNum), transactionHash: receipt.transactionHash } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Escalade (escaladeBlocage: toUserId en uint)
router.put('/:blocageId/escalade', async (req, res) => {
  try {
    const idNum = toUint(req.params.blocageId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'blocageId invalide' });

    const { toUserId, assignedToId, privateKey: pkIn } = req.body || {};
    const targetId = toUint(toUserId ?? assignedToId);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (targetId === null) return res.status(400).json({ success: false, error: 'toUserId/assignedToId invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await fetchBlocage(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Blocage introuvable' });

    try {
      await web3Service.contract.methods
        .escaladeBlocage(idNum, targetId)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction(
      'escaladeBlocage',
      [idNum, targetId],
      null,
      privateKey
    );

    res.json({
      success: true,
      data: {
        blocageId: String(idNum),
        assignedTo: String(targetId),
        transactionHash: receipt.transactionHash
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Resolve (resolveBlocage: byUserId en uint)
router.put('/:blocageId/resolve', async (req, res) => {
  try {
    const idNum = toUint(req.params.blocageId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'blocageId invalide' });

    const { byUserId, resolvedById, newStatus, status, privateKey: pkIn } = req.body || {};
    const resolverId = toUint(byUserId ?? resolvedById);
    const finalStatus = (newStatus ?? status ?? '').toString();
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (resolverId === null) return res.status(400).json({ success: false, error: 'byUserId/resolvedById invalide' });
    if (!finalStatus) return res.status(400).json({ success: false, error: 'newStatus requis' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await fetchBlocage(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Blocage introuvable' });

    // Simulation
    try {
      await web3Service.contract.methods
        .resolveBlocage(idNum, resolverId, finalStatus)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction(
      'resolveBlocage',
      [idNum, resolverId, finalStatus],
      null,
      privateKey
    );

    // Relecture de l’état pour récupérer isBlocking désormais false
    const updated = await fetchBlocage(idNum);

    res.json({
      success: true,
      data: {
        blocageId: String(idNum),
        resolvedBy: String(resolverId),
        status: finalStatus,
        isBlocking: updated ? Boolean(updated.isBlocking) : false,
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// Delete
router.delete('/:blocageId', async (req, res) => {
  try {
    const idNum = toUint(req.params.blocageId);
    const privateKey = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (idNum === null) return res.status(400).json({ success: false, error: 'blocageId invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await fetchBlocage(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Blocage introuvable' });

    try {
      await web3Service.contract.methods.deleteBlocage(idNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction('deleteBlocage', [idNum], null, privateKey);
    res.json({ success: true, data: { blocageId: String(idNum), transactionHash: receipt.transactionHash } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
