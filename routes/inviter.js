const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// Security: require API key for non-GET requests (optional but recommended)
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const expected = process.env.API_KEY;
  if (!expected) return next(); // no API key configured -> skip
  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (provided !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized: invalid API key' });
  }
  next();
});

// Ping (accept all verbs)
router.all('/ping', (_req, res) => {
  res.json({ success: true, route: 'inviter', ping: 'ok' });
});

// Diagnostics
router.get('/', (_req, res) => {
  res.json({
    success: true,
    route: 'inviter',
    endpoints: [
      'GET/POST /api/inviter/ping',
      'POST     /api/inviter/add',
      'GET      /api/inviter/pending/all',
      'GET      /api/inviter/accepted/all',
      'GET      /api/inviter/:inviterId/status',
      'POST     /api/inviter/:inviterId/accept',
      'POST     /api/inviter/:inviterId/reject',
      'POST     /api/inviter/:inviterId/convert',
      'GET      /api/inviter/:inviterId'
    ]
  });
});

// Disallow GET /add
router.get('/add', (_req, res) => {
  res.status(405).json({ success: false, error: 'Use POST /api/inviter/add' });
});

// Add inviter (owner only) - uses body.privateKey or DEPLOYER_PRIVATE_KEY
router.post('/add', async (req, res) => {
  try {
    const { inviterId } = req.body;
    const privateKey = (req.body.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (inviterId === undefined || inviterId === null) {
      return res.status(400).json({ success: false, error: 'inviterId is required' });
    }
    if (!privateKey) {
      return res.status(400).json({ success: false, error: 'Missing privateKey and DEPLOYER_PRIVATE_KEY' });
    }

    const idNum = Number(typeof inviterId === 'string' ? inviterId.trim() : inviterId);
    if (!Number.isFinite(idNum) || idNum < 0) {
      return res.status(400).json({ success: false, error: 'inviterId must be a positive integer' });
    }

    if (!web3Service.web3) await web3Service.initialize();
    if (!web3Service.contract) {
      return res.status(500).json({ success: false, error: 'Contract not loaded. Please deploy or load a contract first.' });
    }

    // Verify owner
    let contractOwner;
    try {
      contractOwner = await web3Service.callMethod('owner', []);
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to verify contract owner.' });
    }

    const account = web3Service.web3.eth.accounts.privateKeyToAccount(
      privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
    );
    if (account.address.toLowerCase() !== contractOwner.toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: `Only contract owner can add inviters. Contract owner: ${contractOwner}, Your address: ${account.address}`
      });
    }

    // Pre-check existence
    try {
      const existing = await web3Service.callMethod('inviters', [idNum]);
      if (existing?.invitedAt && BigInt(existing.invitedAt) > 0n) {
        return res.status(400).json({ success: false, error: `Inviter ${idNum} already exists` });
      }
    } catch {}

    // Send transaction
    const receipt = await web3Service.sendTransaction('addInviter', [idNum], null, privateKey);

    // Verify by state
    let addedInviter;
    let verified = false;
    try {
      addedInviter = await web3Service.callMethod('inviters', [idNum]);
      verified = !!(addedInviter && addedInviter.invitedAt && BigInt(addedInviter.invitedAt) > 0n);
    } catch {}

    if (!receipt.status || !verified) {
      return res.status(500).json({
        success: false,
        error: 'Transaction mined but state change not verified',
        data: {
          transactionHash: receipt.transactionHash,
          blockNumber: String(receipt.blockNumber),
          contractAddress: receipt.to || web3Service.getContractAddress?.()
        }
      });
    }

    return res.json({
      success: true,
      data: {
        inviterId: idNum,
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber),
        contractAddress: receipt.to || web3Service.getContractAddress?.(),
        inviterStatus: addedInviter?.status?.toString?.() ?? '0',
        invitedAt: addedInviter?.invitedAt?.toString?.() ?? ''
      }
    });
  } catch (error) {
    console.error('Add inviter error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Lists first (to avoid capture by "/:inviterId")
router.get('/pending/all', async (_req, res) => {
  try {
    const pendingIds = await web3Service.callMethod('getAllPendingInviterIds', []);
    const inviters = [];
    for (const id of pendingIds) {
      try {
        const inv = await web3Service.callMethod('inviters', [id]);
        inviters.push({
          id: inv.id, status: inv.status, invitedAt: inv.invitedAt,
          respondedAt: inv.respondedAt, isConvertedToProspect: inv.isConvertedToProspect,
          prospectId: inv.prospectId
        });
      } catch (err) {
        console.error(`Error fetching inviter ${id}:`, err.message);
      }
    }
    res.json({ success: true, data: { count: inviters.length, inviters } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/accepted/all', async (_req, res) => {
  try {
    const acceptedIds = await web3Service.callMethod('getAllAcceptedInviterIds', []);
    const inviters = [];
    for (const id of acceptedIds) {
      try {
        const inv = await web3Service.callMethod('inviters', [id]);
        inviters.push({
          id: inv.id, status: inv.status, invitedAt: inv.invitedAt,
          respondedAt: inv.respondedAt, isConvertedToProspect: inv.isConvertedToProspect,
          prospectId: inv.prospectId
        });
      } catch (err) {
        console.error(`Error fetching inviter ${id}:`, err.message);
      }
    }
    res.json({ success: true, data: { count: inviters.length, inviters } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Numeric dynamic routes only
router.get('/:inviterId/status', async (req, res) => {
  try {
    const { inviterId } = req.params;
    const statusString = await web3Service.callMethod('getInviterStatusString', [inviterId]);
    const isPending = await web3Service.callMethod('isInviterPending', [inviterId]);
    const isAccepted = await web3Service.callMethod('isInviterAccepted', [inviterId]);
    const isRejected = await web3Service.callMethod('isInviterRejected', [inviterId]);
    res.json({ success: true, data: { inviterId, statusString, isPending, isAccepted, isRejected } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:inviterId/accept', async (req, res) => {
  try {
    const { inviterId } = req.params;
    const privateKey = (req.body.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (!privateKey) return res.status(400).json({ success: false, error: 'Missing privateKey and DEPLOYER_PRIVATE_KEY' });

    const result = await web3Service.sendTransaction('acceptInvitation', [inviterId], null, privateKey);
    res.json({
      success: true,
      data: { inviterId, transactionHash: result.transactionHash, blockNumber: result.blockNumber, gasUsed: result.gasUsed }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:inviterId/reject', async (req, res) => {
  try {
    const { inviterId } = req.params;
    const privateKey = (req.body.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (!privateKey) return res.status(400).json({ success: false, error: 'Missing privateKey and DEPLOYER_PRIVATE_KEY' });

    const result = await web3Service.sendTransaction('rejectInvitation', [inviterId], null, privateKey);
    res.json({
      success: true,
      data: { inviterId, transactionHash: result.transactionHash, blockNumber: result.blockNumber, gasUsed: result.gasUsed }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:inviterId/convert', async (req, res) => {
  try {
    const { inviterId } = req.params;
    const { name, responsiblePerson } = req.body;
    const privateKey = (req.body.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (!name || !responsiblePerson) {
      return res.status(400).json({ success: false, error: 'name and responsiblePerson are required' });
    }
    if (!privateKey) return res.status(400).json({ success: false, error: 'Missing privateKey and DEPLOYER_PRIVATE_KEY' });

    const result = await web3Service.sendTransaction('convertInviterToProspect', [inviterId, name, responsiblePerson], null, privateKey);
    res.json({
      success: true,
      data: { inviterId, transactionHash: result.transactionHash, blockNumber: result.blockNumber, gasUsed: result.gasUsed }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generic - keep last and numeric only
router.get('/:inviterId', async (req, res) => {
  try {
    const { inviterId } = req.params;
    const inviter = await web3Service.callMethod('inviters', [inviterId]);
    res.json({
      success: true,
      data: {
        id: inviter.id?.toString?.() ?? String(inviterId),
        status: inviter.status?.toString?.() ?? '',
        invitedAt: inviter.invitedAt?.toString?.() ?? '',
        respondedAt: inviter.respondedAt?.toString?.() ?? '',
        isConvertedToProspect: !!inviter.isConvertedToProspect,
        prospectId: inviter.prospectId?.toString?.() ?? '0'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;