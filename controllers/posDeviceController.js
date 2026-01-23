const db = require('../config/db');

// 🟩 CREATE POS DEVICE
exports.createPosDevice = async (req, res) => {
  try {
    const { serial_number, device_model, writer_id, agent_id, platform_reference, status } = req.body;

    if (!serial_number || !device_model || !agent_id || !platform_reference) {
      return res.status(400).json({ msg: 'Missing required fields' });
    }

    // 1️⃣ Get the last POS reference for this platform
    const [lastPos] = await db.query(
      `SELECT pos_reference FROM pos_devices 
       WHERE platform_reference = ? 
       ORDER BY pos_id DESC LIMIT 1`,
      [platform_reference]
    );

    // 2️⃣ Determine new POS reference safely
    let newPosRef = '';
    if (lastPos.length === 0 || !lastPos[0].pos_reference) {
      // No previous POS or pos_reference is null
      newPosRef = `${platform_reference}-001`;
    } else {
      const lastNumber = parseInt(lastPos[0].pos_reference.split('-')[1] || '0');
      const nextNumber = (lastNumber + 1).toString().padStart(3, '0');
      newPosRef = `${platform_reference}-${nextNumber}`;
    }

    // 3️⃣ Insert the new POS device with the new reference
    const [result] = await db.query(
      `INSERT INTO pos_devices 
        (pos_reference, serial_number, device_model, writer_id, agent_id, platform_reference, status, assigned_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
      [newPosRef, serial_number, device_model, writer_id || null, agent_id, platform_reference, status || 'inactive']
    );

    res.status(201).json({ 
      msg: 'POS device created successfully', 
      pos_id: result.insertId, 
      pos_reference: newPosRef 
    });

  } catch (err) {
    console.error('❌ Error creating POS device:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
};

// 🟦 READ ALL POS DEVICES
exports.getAllPosDevices = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM pos_devices ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching POS devices:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
};

// 🟨 READ SINGLE POS DEVICE BY ID


// 🟧 UPDATE POS DEVICE
exports.updatePosDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const { serial_number, device_model, writer_id, agent_id, platform_reference, status, last_login } = req.body;

    const [existing] = await db.query('SELECT * FROM pos_devices WHERE pos_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ msg: 'POS device not found' });
    }

    await db.query(
      `UPDATE pos_devices 
       SET serial_number = ?, device_model = ?, writer_id = ?, agent_id = ?, 
           platform_reference = ?, status = ?, last_login = ?, updated_at = NOW()
       WHERE pos_id = ?`,
      [
        serial_number || existing[0].serial_number,
        device_model || existing[0].device_model,
        writer_id || existing[0].writer_id,
        agent_id || existing[0].agent_id,
        platform_reference || existing[0].platform_reference,
        status || existing[0].status,
        last_login || existing[0].last_login,
        id,
      ]
    );

    res.json({ msg: 'POS device updated successfully' });
  } catch (err) {
    console.error('❌ Error updating POS device:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
};

// 🟥 DELETE POS DEVICE
exports.deletePosDevice = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query('SELECT * FROM pos_devices WHERE pos_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ msg: 'POS device not found' });
    }

    await db.query('DELETE FROM pos_devices WHERE pos_id = ?', [id]);
    res.json({ msg: 'POS device deleted successfully' });
  } catch (err) {
    console.error('❌ Error deleting POS device:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
};

// controllers/posController.js




exports.getPosDevices = async (req, res) => {
  let { agent_id, platform_reference } = req.query;

  if (!agent_id || !platform_reference) {
    return res.status(400).json({ message: 'Agent ID and platform_reference are required' });
  }

  agent_id = Number(agent_id);
  if (isNaN(agent_id)) {
    return res.status(400).json({ message: 'Agent ID must be a number' });
  }

  try {
    const [pos] = await pool.query(
      `SELECT pos_id, pos_reference, agent_id, writer_id, platform_reference
       FROM pos_devices
       WHERE agent_id = ? AND platform_reference = ?
       LIMIT 0, 1000`,
      [agent_id, platform_reference]
    );

    if (pos.length === 0) {
      return res.status(404).json({ msg: 'POS device not found' });
    }

    res.json({ pos });
  } catch (error) {
    console.error('Error fetching POS devices:', error);
    res.status(500).json({ message: 'Server error' });
  }
};






// controllers/assignmentController.js


exports.assignPosToWriter = async (req, res) => {
  const { pos_id, writer_id, agent_id, platform_reference } = req.body;

  if (!pos_id || !writer_id || !agent_id || !platform_reference) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    // 1️⃣ Check POS belongs to this agent + platform
    const [[pos]] = await pool.query(
      `SELECT pos_id, writer_id FROM pos_devices
       WHERE pos_id = ? AND agent_id = ? AND platform_reference = ?`,
      [pos_id, agent_id, platform_reference]
    );

    if (!pos) return res.status(404).json({ message: 'POS not found for this agent and platform' });

    // 2️⃣ Check if POS already assigned
    if (pos.writer_id) {
      return res.status(400).json({ message: 'POS is already assigned to a writer' });
    }

    // 3️⃣ Assign POS to writer
    await pool.query(
      `UPDATE pos_device SET writer_id = ? WHERE pos_id = ?`,
      [writer_id, pos_id]
    );

    res.json({ message: 'POS successfully assigned to writer' });

  } catch (error) {
    console.error('Error assigning POS:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
