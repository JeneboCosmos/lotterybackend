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

    // 2️⃣ Determine new POS reference
    let newPosRef = '';
    if (lastPos.length === 0) {
      newPosRef = `${platform_reference}-001`; // first POS for this platform
    } else {
      const lastNumber = parseInt(lastPos[0].pos_reference.split('-')[1]);
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
exports.getPosDeviceById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM pos_devices WHERE pos_id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ msg: 'POS device not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Error fetching POS device:', err.message);
    res.status(500).json({ msg: 'Internal server error' });
  }
};

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
