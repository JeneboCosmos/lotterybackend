const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const pool = require('../config/db'); // adjust this to your DB config

exports.generateExcelReport = async (req, res) => {
  const { fromDate, toDate } = req.body;
  const agentId = req.user.id;

  try {
    const [rows] = await pool.query(
      `SELECT p.name AS player_name, w.name AS writer_name, b.bet_amount, b.created_at 
       FROM bets b 
       JOIN players p ON b.player_id = p.id 
       JOIN writers w ON p.writer_id = w.id 
       WHERE w.agent_id = ? AND b.created_at BETWEEN ? AND ?`,
      [agentId, fromDate, toDate]
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Performance Report');
    
    sheet.columns = [
      { header: 'Player', key: 'player_name' },
      { header: 'Writer', key: 'writer_name' },
      { header: 'Bet Amount', key: 'bet_amount' },
      { header: 'Date', key: 'created_at' }
    ];
    sheet.addRows(rows);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=report.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to generate Excel report' });
  }
};

exports.generatePDFReport = async (req, res) => {
  const { fromDate, toDate } = req.body;
  const agentId = req.user.id;

  try {
    const [rows] = await pool.query(
      `SELECT p.name AS player_name, w.name AS writer_name, b.bet_amount, b.created_at 
       FROM bets b 
       JOIN players p ON b.player_id = p.id 
       JOIN writers w ON p.writer_id = w.id 
       WHERE w.agent_id = ? AND b.created_at BETWEEN ? AND ?`,
      [agentId, fromDate, toDate]
    );

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=report.pdf');
    doc.pipe(res);

    doc.fontSize(18).text('Performance Report', { align: 'center' });
    doc.moveDown();

    rows.forEach((row, idx) => {
      doc.fontSize(12).text(
        `${idx + 1}. Player: ${row.player_name}, Writer: ${row.writer_name}, Bet: ${row.bet_amount}, Date: ${moment(row.created_at).format('YYYY-MM-DD')}`
      );
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to generate PDF report' });
  }
};
