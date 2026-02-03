/* eslint-env node */
import fs from "fs";
import * as XLSX from "xlsx";

// const prefix = "Google";
const prefixes = [
  "Google",
  "Option1",
  "Option2",
  "Option3",
  "Image Src",
  "Image Position",
  "Variant Image",
  "Image Alt Text",
  "Unit Price",
];

function createExport({ file, filename }) {
  if (!file) {
    console.error("Please provide a file.");
    return { success: false, error: "No file provided" };
  }

  // Determine file type from filename
  const isXlsx = filename.toLowerCase().endsWith(".xlsx");
  const isCsv = filename.toLowerCase().endsWith(".csv");

  function parseCSV(content) {
    const rows = [];
    let currentRow = [];
    let currentField = "";
    let insideQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === "," && !insideQuotes) {
        currentRow.push(currentField);
        currentField = "";
      } else if ((char === "\n" || char === "\r") && !insideQuotes) {
        if (char === "\r" && nextChar === "\n") {
          i++;
        }
        if (currentField || currentRow.length > 0) {
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = "";
        }
      } else {
        currentField += char;
      }
    }

    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    return rows;
  }

  function rowToCSV(row) {
    return row
      .map((field) => {
        const fieldStr = String(field);
        if (
          fieldStr.includes(",") ||
          fieldStr.includes('"') ||
          fieldStr.includes("\n") ||
          fieldStr.includes("\r")
        ) {
          return `"${fieldStr.replace(/"/g, '""')}"`;
        }
        return fieldStr;
      })
      .join(",");
  }

  function transformData(rows) {
    if (rows.length === 0) {
      console.log("No data found in file");
      return [];
    }

    // Get the first row (headers)
    const headers = rows[0];
    console.log("Original headers:", headers);

    // Find indices of columns to remove
    const indicesToRemove = new Set();
    headers.forEach((header, index) => {
      const headerStr = String(header);
      // Remove columns that start with any of the prefixes
      if (prefixes.some((prefix) => headerStr.startsWith(prefix))) {
        indicesToRemove.add(index);
        console.log(`Removing column: "${header}" at index ${index}`);
      }
    });

    // Filter out the specified columns from all rows
    const filteredRows = rows.map((row) => {
      return row.filter((_, index) => !indicesToRemove.has(index));
    });

    console.log(`Removed ${indicesToRemove.size} columns`);
    console.log("New headers:", filteredRows[0]);

    // Find the index of the Variant SKU column
    const variantSKUIndex = filteredRows[0].findIndex(
      (header) => String(header) === "Variant SKU",
    );
    console.log(`Variant SKU column index: ${variantSKUIndex}`);

    const handleMap = new Set();
    const uniqueRows = [filteredRows[0]]; // Keep header row

    // Process data rows (skip header)
    for (let i = 1; i < filteredRows.length; i++) {
      const row = filteredRows[i];
      const handle = row[0] ? row[0].toString().trim() : "";

      const rowSKU = row[variantSKUIndex]
        ? row[variantSKUIndex].toString().trim()
        : "";

      if (rowSKU) {
        handleMap.add(handle);
        uniqueRows.push(row);
      } else {
        continue; // Skip rows without Variant SKU
      }
    }

    console.log(
      `Processed ${rows.length - 1} data rows, kept ${
        uniqueRows.length - 1
      } unique rows`,
    );
    return uniqueRows;
  }

  // Read the file
  let rows;
  let fileBuffer;

  // Handle different file input types
  if (Buffer.isBuffer(file)) {
    fileBuffer = file;
  } else if (typeof file === "string") {
    // If file is a path string
    fileBuffer = fs.readFileSync(file);
  } else if (file.buffer) {
    // If file is a File object from browser
    fileBuffer = Buffer.from(file.buffer);
  } else {
    return { success: false, error: "Invalid file format" };
  }

  if (isXlsx) {
    console.log("Reading XLSX file...");
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  } else if (isCsv) {
    console.log("Reading CSV file...");
    const csvContent = fileBuffer.toString("utf-8");
    rows = parseCSV(csvContent);
  } else {
    console.error(
      "Unsupported file format. Please provide a CSV or XLSX file.",
    );
    return { success: false, error: "Unsupported file format" };
  }

  // Transform the data
  const transformedData = transformData(rows);

  // Generate output
  if (transformedData.length > 0) {
    if (isXlsx) {
      // Generate XLSX output
      const outputWorkbook = XLSX.utils.book_new();
      const outputWorksheet = XLSX.utils.aoa_to_sheet(transformedData);
      XLSX.utils.book_append_sheet(outputWorkbook, outputWorksheet, "Export");
      const outputBuffer = XLSX.write(outputWorkbook, {
        type: "buffer",
        bookType: "xlsx",
      });
      const outputFilename = filename.replace(/\.xlsx$/i, "-export.xlsx");

      console.log(`\nGenerated XLSX export: ${outputFilename}`);
      return {
        success: true,
        filename: outputFilename,
        buffer: outputBuffer,
        rowCount: transformedData.length - 1,
        data: transformedData,
      };
    } else {
      // Generate CSV output
      const csvOutput = transformedData.map((row) => rowToCSV(row)).join("\n");
      const outputBuffer = Buffer.from(csvOutput, "utf-8");
      const outputFilename = filename.replace(/\.csv$/i, "-export.csv");

      console.log(`\nGenerated CSV export: ${outputFilename}`);
      return {
        success: true,
        filename: outputFilename,
        buffer: outputBuffer,
        rowCount: transformedData.length - 1,
        data: transformedData,
      };
    }
  } else {
    console.log("No data to export");
    return { success: false, error: "No data to export" };
  }
}

export { createExport };
