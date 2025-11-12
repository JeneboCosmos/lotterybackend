const db = require('../config/db'); 

// Generate number pool (1 to 90)
const numberPool = Array.from({ length: 90 }, (_, i) => i + 1);

// Utility function: generate combinations of a certain size
const getCombinations = (arr, comboSize) => {
  const result = [];
  const combine = (start, path) => {
    if (path.length === comboSize) {
      result.push([...path]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      path.push(arr[i]);
      combine(i + 1, path);
      path.pop();
    }
  };
  combine(0, []);
  return result;
};

module.exports = {
  // GET: Return the number pool (1–90)
  getNumberPool: (req, res) => {
    console.log('GET /api/number-pool called');
    res.json(numberPool);
  },

  // POST: Create a new play (bet)
  createPlay: async (req, res) => {
    const connection = await db.getConnection();
    try {
      console.log('POST /api/play called');
      console.log('Request body:', req.body);

      const {
        user_id,
        pos_id,
        platform_id,
        platform_reference,
        game_id,
        combination_id,
        selected_numbers,
        stake
      } = req.body;

      if (!Array.isArray(selected_numbers) || selected_numbers.length === 0) {
        return res.status(400).json({ message: "Selected numbers are required" });
      }

      const numbers = selected_numbers.map(Number);
      const formattedNumbers = JSON.stringify(numbers);

      let lines = 1;
      let price = stake;

      switch (combination_id) {
        case 1: case 2: case 3: case 4: case 5:
          if (numbers.length !== combination_id) {
            return res.status(400).json({
              message: `Direct ${combination_id} requires exactly ${combination_id} numbers`
            });
          }
          break;
        case 6:
          if (numbers.length < 2) return res.status(400).json({ message: "Perm 2 requires at least 2 numbers" });
          lines = getCombinations(numbers, 2).length;
          price = stake * lines;
          break;
        case 7:
          if (numbers.length < 3) return res.status(400).json({ message: "Perm 3 requires at least 3 numbers" });
          lines = getCombinations(numbers, 3).length;
          price = stake * lines;
          break;
        case 8:
          if (numbers.length !== 1) return res.status(400).json({ message: "Banker requires exactly 1 number" });
          lines = 89;
          price = stake * lines;
          break;
        default:
          return res.status(400).json({ message: "Unsupported combination type" });
      }

      // ✅ Check user balance
      const [userRows] = await connection.execute('SELECT balance FROM users WHERE user_id = ?', [user_id]);
      if (userRows.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      const userBalance = parseFloat(userRows[0].balance);
      if (userBalance < price) {
        return res.status(400).json({ message: "Insufficient balance" });
      }

      // ✅ Deduct balance
      await connection.execute('UPDATE users SET balance = balance - ? WHERE user_id = ?', [price, user_id]);

      // ✅ Generate ticket and draw date
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const randomPart = Math.floor(100000 + Math.random() * 900000);
      const ticket_number = `TCK-${datePart}-${randomPart}`;
      const barcode = `BAR-${ticket_number}`;

      const currentTime = now.getHours() * 60 + now.getMinutes();
      const cutoffTime = 19 * 60 + 30;
      let drawDate = new Date(now);
      if (currentTime >= cutoffTime) drawDate.setDate(drawDate.getDate() + 1);
      drawDate.setHours(19, 30, 0, 0);

      // ✅ Insert play record
      const [result] = await connection.execute(
        `INSERT INTO play (
          ticket_number, barcode, platform_reference,
          user_id, pos_id, platform_id, game_id, combination_id,
          \`lines\`, selected_numbers, stake, price,
          play_date, draw_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ticket_number, barcode, platform_reference, user_id, pos_id, platform_id,
         game_id, combination_id, lines, formattedNumbers, stake, price, now, drawDate]
      );

      res.status(201).json({
        message: 'Play created successfully',
        play_id: result.insertId,
        ticket_number,
        barcode,
        lines,
        price,
        draw_date: drawDate,
        remaining_balance: userBalance - price
      });

    } catch (err) {
      console.error('Error creating play:', err);
      res.status(500).json({ message: 'Error saving play', error: err.message });
    } finally {
      connection.release();
    }
  },

  // GET: Fetch all plays
  getAllPlays: async (req, res) => {
    const connection = await db.getConnection();
    try {
      console.log('GET /api/plays called');
      const [results] = await connection.execute('SELECT * FROM play ORDER BY play_date DESC');
      res.json(results);
    } catch (err) {
      console.error('Error fetching plays:', err);
      res.status(500).json({ message: 'Error fetching plays', error: err.message });
    } finally {
      connection.release();
    }
  },

  // POST: Preview combination (calculate lines and price before play)
  previewCombination: (req, res) => {
    const { selected_numbers, stake, combination_id } = req.body;

    if (!Array.isArray(selected_numbers) || selected_numbers.length === 0) {
      return res.status(400).json({ message: "Selected numbers are required" });
    }

    const numbers = selected_numbers.map(Number);
    let lines = 1;
    let price = stake;

    try {
      switch (combination_id) {
        case 1: case 2: case 3: case 4: case 5:
          if (numbers.length !== combination_id) {
            return res.status(400).json({
              message: `Direct ${combination_id} requires exactly ${combination_id} numbers`
            });
          }
          break;
        case 6:
          if (numbers.length < 2) {
            return res.status(400).json({ message: "Perm 2 requires at least 2 numbers" });
          }
          lines = getCombinations(numbers, 2).length;
          break;
        case 7:
          if (numbers.length < 3) {
            return res.status(400).json({ message: "Perm 3 requires at least 3 numbers" });
          }
          lines = getCombinations(numbers, 3).length;
          break;
        case 8:
          if (numbers.length !== 1) {
            return res.status(400).json({ message: "Banker requires exactly 1 number" });
          }
          lines = 89;
          break;
        default:
          return res.status(400).json({ message: "Unsupported combination type" });
      }

      price = lines * stake;

      res.json({
        message: "Preview successful",
        lines,
        price
      });
    } catch (err) {
      console.error('Error in preview:', err);
      res.status(500).json({ message: 'Error previewing combination', error: err.message });
    }
  }
};
