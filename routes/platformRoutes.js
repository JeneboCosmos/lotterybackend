const express = require('express');
const router = express.Router();
const db = require('../config/db'); // mysql2/promise connection

// Helper: Generate unique platform reference
// Helper: Generate next sequential platform reference
async function generateSequentialPlatformReference() {
  const prefix = 'PLAT';

  // Get the last inserted platform_reference number
  const [rows] = await db.query(
    `SELECT platform_reference 
     FROM platforms 
     WHERE platform_reference LIKE '${prefix}%' 
     ORDER BY platform_id DESC LIMIT 1`
  );

  let nextNumber = 1;
  if (rows.length > 0) {
    const lastRef = rows[0].platform_reference; // e.g., "PLAT5"
    const lastNumber = parseInt(lastRef.replace(prefix, ''), 10);
    nextNumber = lastNumber + 1;
  }

  return prefix + nextNumber;
}


// === Create a new platform (admin only) ===
router.post('/', async (req, res) => {
  const { platform_name, admin_id, status = 'active' } = req.body;

  if (!admin_id || !platform_name) {
    return res.status(400).json({ msg: 'admin_id and platform_name are required' });
  }

  try {
    // Validate admin
    const [adminRows] = await db.query(
      'SELECT * FROM users WHERE user_id = ? AND role = ?',
      [admin_id, 'admin']
    );
    if (adminRows.length === 0) {
      return res.status(403).json({ msg: 'Invalid admin_id or user is not an admin' });
    }

    // Generate sequential platform_reference
    const platform_reference = await generateSequentialPlatformReference();

    const sql = `
      INSERT INTO platforms (platform_reference, platform_name, admin_id, status)
      VALUES (?, ?, ?, ?)
    `;
    const [result] = await db.query(sql, [platform_reference, platform_name, admin_id, status]);

    res.status(201).json({
      msg: 'Platform created successfully',
      platform_id: result.insertId,
      platform_reference,
      platform_name,
      admin_id,
      status
    });
  } catch (err) {
    console.error('Error creating platform:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
});

// === Assign an agent to a platform ===
router.put('/:id/assign-agent', async (req, res) => { 
  const { id } = req.params; // platform ID
  const { agent_id } = req.body;

  if (!agent_id) {
    return res.status(400).json({ msg: 'agent_id is required' });
  }

  try {
    // 1️⃣ Verify that the agent exists
    const [agentRows] = await db.query(
      'SELECT * FROM users WHERE user_id = ? AND role = ?',
      [agent_id, 'agent']
    );

    if (agentRows.length === 0) {
      return res.status(400).json({ msg: 'Invalid agent_id or user is not an agent' });
    }

    // 2️⃣ Verify that the platform exists
    const [platformRows] = await db.query(
      'SELECT * FROM platforms WHERE platform_id = ?',
      [id]
    );

    if (platformRows.length === 0) {
      return res.status(404).json({ msg: 'Platform not found' });
    }

    // 3️⃣ Prevent double linking
    if (platformRows[0].agent_id) {
      return res.status(400).json({
        msg: '❌ This platform is already linked to an agent and cannot be reassigned.'
      });
    }

    // 4️⃣ Assign agent
    await db.query(
      'UPDATE platforms SET agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE platform_id = ?',
      [agent_id, id]
    );

    res.json({ msg: '✅ Agent assigned to platform successfully' });
  } catch (err) {
    console.error('Error assigning agent:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
});

// === Get all platforms ===
router.get('/', async (req, res) => {
  try {
    const [platforms] = await db.query('SELECT * FROM platforms');
    res.json(platforms);
  } catch (err) {
    console.error('Error fetching platforms:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
});

// === Get platform by ID ===
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      'SELECT * FROM platforms WHERE platform_id = ?',
      [id]
    );
    if (rows.length === 0)
      return res.status(404).json({ msg: 'Platform not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching platform:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
});

// === Update platform ===
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    platform_reference,
    platform_name,
    agent_id,
    admin_id,
    status
  } = req.body;

  try {
    const [rows] = await db.query(
      'SELECT * FROM platforms WHERE platform_id = ?',
      [id]
    );
    if (rows.length === 0)
      return res.status(404).json({ msg: 'Platform not found' });

    if (admin_id) {
      const [adminRows] = await db.query(
        'SELECT * FROM users WHERE user_id = ? AND role = ?',
        [admin_id, 'admin']
      );
      if (adminRows.length === 0) {
        return res.status(403).json({ msg: 'Invalid admin_id or user is not an admin' });
      }
    }

    if (agent_id) {
      const [agentRows] = await db.query(
        'SELECT * FROM users WHERE user_id = ? AND role = ?',
        [agent_id, 'agent']
      );
      if (agentRows.length === 0) {
        return res.status(400).json({ msg: 'Invalid agent_id or user is not an agent' });
      }
    }

    const sql = `
      UPDATE platforms SET
        platform_reference = COALESCE(?, platform_reference),
        platform_name = COALESCE(?, platform_name),
        agent_id = COALESCE(?, agent_id),
        admin_id = COALESCE(?, admin_id),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE platform_id = ?
    `;

    await db.query(sql, [
      platform_reference,
      platform_name,
      agent_id,
      admin_id,
      status,
      id
    ]);

    res.json({ msg: 'Platform updated successfully' });
  } catch (err) {
    console.error('Error updating platform:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ msg: 'Platform reference already exists' });
    }
    res.status(500).json({ msg: 'Internal server error' });
  }
});

// === Delete platform ===
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query(
      'DELETE FROM platforms WHERE platform_id = ?',
      [id]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ msg: 'Platform not found' });

    res.json({ msg: 'Platform deleted successfully' });
  } catch (err) {
    console.error('Error deleting platform:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
});
// PUT /api/users/:writerId/link-platform
// PUT /api/users/:id/assign-platform
router.put('/users/:id/assign-platform', async (req, res) => {
  const { id } = req.params;
  const { platform_id, agent_id } = req.body;

  if (!platform_id || !agent_id) {
    return res.status(400).json({ msg: 'platform_id and agent_id are required' });
  }

  const [rows] = await db.query(
    'SELECT * FROM platforms WHERE platform_id = ? AND agent_id = ?',
    [platform_id, agent_id]
  );
  if (rows.length === 0) {
    return res.status(400).json({ msg: 'Platform does not belong to the specified agent' });
  }

  await db.query(
    'UPDATE users SET platform_id = ?, agent_id = ? WHERE user_id = ? AND role = "writer"',
    [platform_id, agent_id, id]
  );

  res.json({ msg: 'Writer assigned to platform successfully' });
});


// === Get a single agent and all their platforms ===



router.get("/:platformReference", async (req, res) => {
  const { platformReference } = req.params;

  try {
    const [rows] = await db.execute(
      `SELECT 
          combination_id,
          COUNT(*) AS total_tickets,
          SUM(price) AS total_sales,
          SUM(stake) AS total_stake
       FROM play
       WHERE platform_reference = ?
       GROUP BY combination_id
       ORDER BY combination_id ASC`,
      [platformReference]
    );

    // Return empty array if no data
    return res.status(200).json(rows || []);
  } catch (err) {
    console.error("❌ Error fetching game histogram:", err);
    return res.status(500).json({ message: "Server error fetching game histogram" });
  }
});



router.get('/agents/:id/platforms', async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch the agent
    const [agentRows] = await db.query(
  `SELECT user_id, username, email, phone, role, balance 
   FROM users 
   WHERE user_id = ? AND role = 'agent'`,
  [id]
);


    if (agentRows.length === 0) return res.status(404).json({ msg: 'Agent not found' });

    const agent = agentRows[0];

    // Fetch all platforms assigned to this agent
    const [platforms] = await db.query(
      'SELECT platform_id, platform_reference, platform_name, status FROM platforms WHERE agent_id = ?',
      [id]
    );

    agent.number_of_platforms = platforms.length;

    res.json({ agent, platforms });
  } catch (err) {
    console.error('Error fetching agent and platforms:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
});



// === Reassign a platform to another agent ===
router.put('/:id/reassign-agent', async (req, res) => {
  const { id } = req.params; // platform ID
  const { new_agent_id } = req.body;

  if (!new_agent_id) {
    return res.status(400).json({ msg: 'new_agent_id is required' });
  }

  try {
    // 1️⃣ Verify the new agent exists
    const [agentRows] = await db.query(
      'SELECT * FROM users WHERE user_id = ? AND role = ?',
      [new_agent_id, 'agent']
    );
    if (agentRows.length === 0) {
      return res.status(400).json({ msg: 'Invalid agent_id or user is not an agent' });
    }

    // 2️⃣ Verify the platform exists
    const [platformRows] = await db.query(
      'SELECT * FROM platforms WHERE platform_id = ?',
      [id]
    );
    if (platformRows.length === 0) {
      return res.status(404).json({ msg: 'Platform not found' });
    }

    // 3️⃣ Reassign agent (even if previously assigned)
    await db.query(
      'UPDATE platforms SET agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE platform_id = ?',
      [new_agent_id, id]
    );

    res.json({ msg: '✅ Platform reassigned to new agent successfully' });
  } catch (err) {
    console.error('Error reassigning platform:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
});







module.exports = router;
