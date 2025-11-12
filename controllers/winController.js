const db = require('../config/db');

// Utility to generate combinations
const getCombinations = (arr, size) => {
  const result = [];
  const combine = (start, path) => {
    if (path.length === size) {
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

// Win checking logic
const checkWin = (combinationId, numbers, draw) => {
  const drawSet = new Set(draw);
  let win = false;
  let match = [];

  switch (parseInt(combinationId)) {
    case 1:
      win = numbers.includes(draw[0]);
      match = win ? [draw[0]] : [];
      break;
    case 2:
      match = numbers.filter(n => drawSet.has(n));
      win = match.length === 2;
      break;
    case 3:
      match = numbers.filter(n => drawSet.has(n));
      win = match.length === 3;
      break;
    case 4:
      match = numbers.filter(n => drawSet.has(n));
      win = match.length === 4;
      break;
    case 5:
      match = numbers.filter(n => drawSet.has(n));
      win = match.length === 5;
      break;
    case 6:
      const perm2 = getCombinations(numbers, 2);
      for (const combo of perm2) {
        const cMatch = combo.filter(n => drawSet.has(n));
        if (cMatch.length === 2) {
          win = true;
          match = cMatch;
          break;
        }
      }
      break;
    case 7:
      const perm3 = getCombinations(numbers, 3);
      for (const combo of perm3) {
        const cMatch = combo.filter(n => drawSet.has(n));
        if (cMatch.length === 3) {
          win = true;
          match = cMatch;
          break;
        }
      }
      break;
    case 8:
      const banker = numbers[0];
      win = drawSet.has(banker);
      match = win ? [banker] : [];
      break;
    default:
      win = false;
      match = [];
  }

  return { win, match };
};

// Payout multipliers
const payoutMultipliers = {
  1: 40,
  2: 240,
  3: 1920,
  4: 240,
  5: 300,
  6: 240,
  7: 1920,
  8: 960,
};

// Main function
module.exports = {
  processDraw: async (req, res) => {
    const { game_id, draw_date, draw } = req.body;

    console.log(`\n[🎯 Draw Start] Game: ${game_id}, Date: ${draw_date}, Draw: ${draw}`);

    if (!game_id || !draw_date || !Array.isArray(draw) || draw.length !== 5) {
      console.log('[❌ Invalid input] Missing or incorrect draw numbers');
      return res.status(400).json({ message: "Invalid input. Must provide 5 draw numbers." });
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();
      console.log('[🔹 Transaction started]');

      // ✅ Check existing draw
      const [existing] = await connection.execute(
        'SELECT * FROM draw WHERE game_id = ? AND draw_date = ?',
        [game_id, draw_date]
      );

      if (existing.length > 0) {
        await connection.rollback();
        connection.release();
        console.log(`[❌ Draw already exists] Game ID: ${game_id}, Date: ${draw_date}`);
        return res.status(409).json({ message: "Draw already exists for this date." });
      }

      // ✅ Insert new draw
      const [drawResult] = await connection.execute(
        'INSERT INTO draw (game_id, draw_date, draw_numbers, created_at) VALUES (?, ?, ?, ?)',
        [game_id, draw_date, JSON.stringify(draw), new Date()]
      );

      const drawId = drawResult.insertId;
      console.log(`✅ Draw inserted with ID: ${drawId}`);

      // ✅ Fetch all plays (including ticket_number & platform_reference)
      const [plays] = await connection.execute(
        `SELECT * FROM play 
         WHERE game_id = ? 
         AND play_date >= ? 
         AND play_date < DATE_ADD(?, INTERVAL 1 DAY)`,
        [game_id, draw_date, draw_date]
      );

      console.log(`🎯 Found ${plays.length} plays for this draw`);

      if (plays.length === 0) {
        await connection.commit();
        connection.release();
        console.log('[🔹 Transaction committed] No plays found');
        return res.status(200).json({
          message: "✅ Draw processed successfully, but no plays found for this draw.",
          game_id,
          draw_date,
          draw,
          total_plays: 0,
          winners: 0,
          results: [],
        });
      }

      const results = [];
      let winCount = 0;

      for (const play of plays) {
        const numbers = JSON.parse(play.selected_numbers);
        const { win, match } = checkWin(play.combination_id, numbers, draw);
        const stakeAmount = parseFloat(play.stake || 1);
        const multiplier = payoutMultipliers[play.combination_id] || 1;
        const prizeAmount = win ? stakeAmount * multiplier : 0.0;
        if (win) winCount++;

        // ✅ Insert into play_result with ticket_number & platform_reference
        await connection.execute(
          `INSERT INTO play_result (
            play_id, game_id, combination_id, user_id, draw_id,
            selected_numbers, drawn_numbers, matched_numbers, matched_count,
            is_win, prize_amount, status, ticket_number, platform_reference, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            play.play_id,
            play.game_id,
            play.combination_id,
            play.user_id,
            drawId,
            play.selected_numbers,
            JSON.stringify(draw),
            JSON.stringify(match),
            match.length,
            win ? 1 : 0,
            prizeAmount,
            win ? "claimed" : "lost",
            play.ticket_number,              // ✅ from play table
            play.platform_reference,         // ✅ from play table
            new Date(),
          ]
        );

        console.log(
          `✅ play_result inserted for play_id: ${play.play_id}, win: ${win}, prize: ${prizeAmount}`
        );

        // ✅ Add them to the returned results
        results.push({
          play_id: play.play_id,
          user_id: play.user_id,
          game_id: play.game_id,
          combination_id: play.combination_id,
          draw_id: drawId,
          selected_numbers: numbers,
          drawn_numbers: draw,
          matched_numbers: match,
          matched_count: match.length,
          is_win: win,
          stake_amount: stakeAmount,
          prize_amount: prizeAmount,
          status: win ? "claimed" : "lost",
          ticket_number: play.ticket_number,              // ✅ include
          platform_reference: play.platform_reference,    // ✅ include
          created_at: new Date().toISOString(),
        });
      }

      await connection.commit();
      connection.release();

      console.log(`[🔹 Transaction committed] Total winners: ${winCount}`);

      res.status(200).json({
        message: "✅ Draw processed successfully",
        game_id,
        draw_date,
        draw,
        total_plays: plays.length,
        winners: winCount,
        results,
      });
    } catch (err) {
      await connection.rollback();
      connection.release();
      console.error("[💥 Draw Processing Error]", err);
      res.status(500).json({ message: "Failed to process draw", error: err.message });
    }
  },
};



