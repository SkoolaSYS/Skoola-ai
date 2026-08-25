const express = require("express");
const cors = require("cors");
const axios = require("axios");
const db = require("./db");
require("dotenv").config();
const aiDb = require("./database/ai-db");
const schoolDb = require("./database/school-db");
const multer = require("multer");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

const schoolDocumentDirectory = path.join(
  __dirname,
  "uploads",
  "school-documents"
);

if (!fs.existsSync(schoolDocumentDirectory)) {
  fs.mkdirSync(schoolDocumentDirectory, {
    recursive: true
  });
}

app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"))
);

const documentStorage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, schoolDocumentDirectory);
  },

  filename: function (req, file, callback) {
    const uniqueName =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);

    callback(null, uniqueName);
  }
});

const documentFileFilter = function (req, file, callback) {
  const allowedMimeTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png"
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return callback(
      new Error("Only PDF, JPG, JPEG and PNG files are allowed.")
    );
  }

  callback(null, true);
};

const uploadSchoolDocument = multer({
  storage: documentStorage,

  limits: {
    fileSize: 10 * 1024 * 1024
  },

  fileFilter: documentFileFilter
});

async function extractEventsFromText(extractedText, documentTitle) {
  const currentYear = new Date().getFullYear();

  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "openai/gpt-oss-20b",

      messages: [
        {
          role: "system",
          content: `
You analyse school documents and extract school events.

Return valid JSON only using this exact structure:

{
  "events": [
    {
      "title": "Event title",
      "description": "Event information or null",
      "event_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null",
      "start_time": "HH:MM:SS or null",
      "end_time": "HH:MM:SS or null",
      "location": "Location or null",
      "source_text": "Original relevant text"
    }
  ]
}

Rules:

1. Extract every school event, holiday, examination, meeting,
   activity, deadline and programme that has a clear date.
2. Do not invent events or dates.
3. event_date must use YYYY-MM-DD.
4. Use null when information is unavailable.
5. If a date range exists, use the first date for event_date
   and the final date for end_date.
6. If the document clearly refers to ${currentYear}, use that year.
7. If the year cannot be determined safely, exclude the event.
8. Do not treat headings as events.
9. If there are no events, return {"events":[]}.
10. Return JSON only without Markdown.
          `
        },
        {
          role: "user",
          content: `
Document title:
${documentTitle}

Document contents:
${extractedText}
          `
        }
      ],

      temperature: 0,

      response_format: {
        type: "json_object"
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },

      timeout: 60000
    }
  );

  const responseText =
    response.data &&
    response.data.choices &&
    response.data.choices[0] &&
    response.data.choices[0].message
      ? response.data.choices[0].message.content
      : '{"events":[]}';

  const parsed = JSON.parse(responseText);

  return Array.isArray(parsed.events)
    ? parsed.events
    : [];
}

const chatAttachmentDirectory = path.join(
  __dirname,
  "uploads",
  "chat-attachments"
);

if (!fs.existsSync(chatAttachmentDirectory)) {
  fs.mkdirSync(chatAttachmentDirectory, {
    recursive: true
  });
}

const chatAttachmentStorage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, chatAttachmentDirectory);
  },

  filename: function (req, file, callback) {
    const uniqueName =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);

    callback(null, uniqueName);
  }
});

const chatAttachmentFilter = function (req, file, callback) {
  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png"
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    return callback(
      new Error("Only PDF, JPG, JPEG and PNG files are allowed.")
    );
  }

  callback(null, true);
};

const uploadChatAttachment = multer({
  storage: chatAttachmentStorage,

  limits: {
    fileSize: 10 * 1024 * 1024
  },

  fileFilter: chatAttachmentFilter
});

app.post(
  "/teacher-parent-messages/upload",
  uploadChatAttachment.single("attachment"),

  async (req, res) => {
    let documentId = null;

    try {
      const teacherUserId = Number(req.body.teacherUserId);
      const parentUserId = Number(req.body.parentUserId);
      const studentId = Number(req.body.studentId);

      const schoolClassId =
        req.body.schoolClassId &&
        req.body.schoolClassId !== "null"
          ? Number(req.body.schoolClassId)
          : null;

      const message = String(req.body.message || "").trim();

      if (!teacherUserId || !parentUserId || !studentId) {
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        return res.status(400).json({
          error:
            "Teacher ID, parent ID and student ID are required."
        });
      }

      if (!req.file && !message) {
        return res.status(400).json({
          error: "Please enter a message or attach a file."
        });
      }

      let attachmentPath = null;
      let attachmentName = null;
      let attachmentType = null;

      if (req.file) {
        attachmentPath =
          "/uploads/chat-attachments/" +
          req.file.filename;

        attachmentName = req.file.originalname;
        attachmentType = req.file.mimetype;
      }

      /*
       * If the teacher attaches a PDF, scan it and create events.
       */
      if (
        req.file &&
        req.file.mimetype === "application/pdf"
      ) {
        const extractedText = await extractPdfText(
          req.file.path
        );

        if (extractedText) {
          const [documentResult] = await aiDb.query(
            `
            INSERT INTO school_documents
            (
              uploaded_by,
              title,
              document_type,
              original_filename,
              stored_filename,
              file_path,
              mime_type,
              extracted_text,
              processing_status
            )
            VALUES (?, ?, 'other', ?, ?, ?, ?, ?, 'processing')
            `,
            [
              teacherUserId,
              req.file.originalname,
              req.file.originalname,
              req.file.filename,
              attachmentPath,
              req.file.mimetype,
              extractedText
            ]
          );

          documentId = documentResult.insertId;

          const events = await extractEventsFromText(
            extractedText,
            req.file.originalname
          );

          await saveExtractedEvents(
            documentId,
            teacherUserId,
            schoolClassId,
            events
          );

          await aiDb.query(
            `
            UPDATE school_documents
            SET processing_status = 'completed'
            WHERE id = ?
            `,
            [documentId]
          );
        }
      }

      const [messageResult] = await aiDb.query(
        `
        INSERT INTO parent_teacher_messages
        (
          parent_user_id,
          teacher_user_id,
          student_id,
          sender_role,
          message,
          attachment_name,
          attachment_path,
          attachment_type,
          document_id,
          is_read
        )
        VALUES (?, ?, ?, 'teacher', ?, ?, ?, ?, ?, 0)
        `,
        [
          parentUserId,
          teacherUserId,
          studentId,
          message,
          attachmentName,
          attachmentPath,
          attachmentType,
          documentId
        ]
      );

      return res.status(201).json({
        success: true,
        message: "Message sent successfully.",
        messageId: messageResult.insertId,
        attachment: req.file
          ? {
              name: attachmentName,
              path: attachmentPath,
              type: attachmentType
            }
          : null,
        documentId
      });
    } catch (error) {
      console.error(
        "TEACHER CHAT ATTACHMENT ERROR:",
        error.response
          ? error.response.data
          : error
      );

      return res.status(500).json({
        error: "Failed to send attachment.",
        details:
          error.response &&
          error.response.data &&
          error.response.data.error
            ? error.response.data.error.message
            : error.message
      });
    }
  }
);

const schoolDocumentsFolder = path.join(
  __dirname,
  "uploads",
  "school-documents"
);

if (!fs.existsSync(schoolDocumentsFolder)) {
  fs.mkdirSync(schoolDocumentsFolder, {
    recursive: true
  });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, schoolDocumentsFolder);
  },

  filename: function (req, file, cb) {
    const uniqueName =
      Date.now() +
      "-" +
      file.originalname.replace(/\s+/g, "-");

    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png"
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(
        new Error(
          "Only PDF, JPG, JPEG and PNG files are allowed."
        )
      );
    }

    cb(null, true);
  }
});

app.post(
  "/school-documents/upload",
  upload.single("file"),

  async (req, res) => {
    let documentId = null;

    try {
      const teacherId = Number(req.body.teacherId);
      const eventScope = req.body.eventScope || "school";
      const title = String(req.body.title || "").trim();

      const documentType =
        req.body.documentType || "other";

      const schoolClassId =
        req.body.schoolClassId &&
        req.body.schoolClassId !== "null"
          ? Number(req.body.schoolClassId)
          : null;

      const [teacherRows] = await schoolDb.query(
        `
        SELECT id, name, school_id
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [teacherId]
      );

      if (teacherRows.length === 0) {
        return res.status(404).json({
          message: "Teacher account was not found."
        });
      }

      const teacher = teacherRows[0];

      const schoolId = Number(teacher.school_id);

      let finalSchoolClassId = null;

      if (eventScope === "class") {
        if (!schoolClassId) {
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }

          return res.status(400).json({
            message:
              "A school class must be selected for a class-specific document."
          });
        }

        finalSchoolClassId = schoolClassId;
      } else {
        finalSchoolClassId = null;
      }

      if (!teacher.school_id) {
        return res.status(400).json({
          message: "This teacher is not assigned to a school."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "Please attach a PDF or image."
        });
      }

      if (!teacherId || !title) {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        return res.status(400).json({
          error: "Teacher ID and document title are required."
        });
      }

      /*
       * Confirm the teacher exists.
       */
      const [teachers] = await schoolDb.query(
        `
        SELECT id, name
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [teacherId]
      );

      if (!teachers.length) {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        return res.status(404).json({
          error: "Teacher account was not found."
        });
      }

      /*
       * Confirm the selected class exists when a class was supplied.
       */
      if (finalSchoolClassId) {
        const [classes] = await schoolDb.query(
          `
          SELECT id
          FROM school_classes
          WHERE id = ?
            AND school_id = ?
          LIMIT 1
          `,
          [finalSchoolClassId, schoolId]
        );

        if (!classes.length) {
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }

          return res.status(404).json({
            error:
              "The selected class was not found in the teacher's school."
          });
        }
      }

      const relativeFilePath =
        "/uploads/school-documents/" +
        req.file.filename;

      /*
       * Save the original document record.
       */
      const [documentResult] = await aiDb.query(
        `
        INSERT INTO school_documents
        (
          uploaded_by,
          title,
          document_type,
          original_filename,
          stored_filename,
          file_path,
          mime_type,
          processing_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'processing')
        `,
        [
          teacherId,
          title,
          documentType,
          req.file.originalname,
          req.file.filename,
          relativeFilePath,
          req.file.mimetype
        ]
      );

      documentId = documentResult.insertId;

      let extractedText = "";

      /*
       * For now, process text-based PDFs.
       * Image processing will be added after this works.
       */
      if (req.file.mimetype === "application/pdf") {
        extractedText = await extractPdfText(
          req.file.path
        );
        if (!extractedText.trim()) {
  return res.status(400).json({
    message:
      "The PDF was opened successfully, but no readable text was found. It may contain scanned images instead of selectable text."
  });
}
      } else {
        await aiDb.query(
          `
          UPDATE school_documents
          SET
            processing_status = 'failed',
            processing_error = ?
          WHERE id = ?
          `,
          [
            "Image scanning has not been configured yet.",
            documentId
          ]
        );

        return res.status(422).json({
          error:
            "The image was uploaded, but image scanning is not configured yet.",
          documentId
        });
      }

      if (!extractedText.trim()) {
        await aiDb.query(
          `
          UPDATE school_documents
          SET
            processing_status = 'failed',
            processing_error = ?
          WHERE id = ?
          `,
          [
            "No readable text was found in the PDF.",
            documentId
          ]
        );

        return res.status(422).json({
          error:
            "No readable text was found. The PDF may be a scanned document.",
          documentId
        });
      }

      /*
       * Save the text extracted from the PDF.
       */
      await aiDb.query(
        `
        UPDATE school_documents
        SET extracted_text = ?
        WHERE id = ?
        `,
        [extractedText, documentId]
      );

      /*
       * Ask Groq to identify all events.
       */
      const extractedEvents =
        await extractEventsFromText(
          extractedText,
          title
        );

      /*
       * Save the identified events as pending.
       */
      await saveExtractedEvents(
        documentId,
        teacherId,
        schoolId,
        finalSchoolClassId,
        extractedEvents
      );

      await aiDb.query(
        `
        UPDATE school_documents
        SET
          processing_status = 'completed',
          processing_error = NULL
        WHERE id = ?
        `,
        [documentId]
      );

      return res.status(201).json({
        success: true,
        message:
          "Document uploaded and scanned successfully.",
        documentId,
        extractedEventCount: extractedEvents.length,
        events: extractedEvents
      });
    } catch (error) {
      console.error(
        "SCHOOL DOCUMENT UPLOAD ERROR:",
        error
      );

      if (documentId) {
        try {
          await aiDb.query(
            `
            UPDATE school_documents
            SET
              processing_status = 'failed',
              processing_error = ?
            WHERE id = ?
            `,
            [
              error.message ||
                "Document processing failed.",
              documentId
            ]
          );
        } catch (updateError) {
          console.error(
            "DOCUMENT STATUS UPDATE ERROR:",
            updateError
          );
        }
      }

      return res.status(500).json({
        error: "Failed to process the document.",
        details: error.message
      });
    }
  }
);

async function extractPdfText(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);

    // Confirm that the uploaded file is actually a PDF
    const fileHeader = fileBuffer
      .slice(0, 5)
      .toString("utf8");

    if (fileHeader !== "%PDF-") {
      throw new Error(
        "The uploaded file is not a valid PDF file."
      );
    }

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(fileBuffer),
      disableFontFace: true,
      useSystemFonts: true
    });

    const pdfDocument = await loadingTask.promise;

    let extractedText = "";

    for (
      let pageNumber = 1;
      pageNumber <= pdfDocument.numPages;
      pageNumber++
    ) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map(item => {
          return item.str || "";
        })
        .join(" ");

      extractedText += pageText + "\n";
    }

    return extractedText.trim();
  } catch (error) {
    console.error("PDF extraction error:", error);

    throw new Error(
      error.message ||
      "Unable to extract text from this PDF."
    );
  }
}

async function saveExtractedEvents(
  documentId,
  teacherId,
  schoolId,
  schoolClassId,
  events
) {
  for (const event of events) {
    if (!event.title || !event.event_date) {
      continue;
    }

    const eventMessage = [
      event.description || null,
      event.location
        ? `Location: ${event.location}`
        : null,
      event.start_time
        ? `Start time: ${event.start_time}`
        : null,
      event.end_time
        ? `End time: ${event.end_time}`
        : null,
      event.source_text || null
    ]
      .filter(Boolean)
      .join("\n");

    await aiDb.query(
      `
      INSERT INTO school_events
      (
        teacher_id,
        school_id,
        school_class_id,
        document_id,
        title,
        message,
        event_date,
        end_date,
        verification_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `,
      [
        teacherId,
        schoolId,
        schoolClassId,
        documentId,
        event.title,
        eventMessage || "",
        event.event_date,
        event.end_date || null
      ]
    );
  }
}


function getMalaysiaDate() {
  const malaysiaDate = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kuala_Lumpur"
    })
  );

  return formatLocalDate(malaysiaDate);
}

function getMalaysiaToday() {
  const malaysiaDate = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kuala_Lumpur"
    })
  );

  malaysiaDate.setHours(0, 0, 0, 0);

  return malaysiaDate;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDateForAI(dateValue) {
  if (!dateValue) {
    return "Unknown date";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return String(dateValue);
  }

  return date.toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function getUpcomingWeekday(targetDay, useNextWeek = false) {
  const today = getMalaysiaToday();
  const currentDay = today.getDay();

  let daysUntilTarget = (targetDay - currentDay + 7) % 7;

  // "This Friday" means the nearest Friday.
  if (daysUntilTarget === 0 && useNextWeek) {
    daysUntilTarget = 7;
  }

  // "Next Friday" means the Friday in the following week.
  if (useNextWeek && daysUntilTarget < 7) {
    daysUntilTarget += 7;
  }

  const result = new Date(today);
  result.setDate(today.getDate() + daysUntilTarget);

  return formatLocalDate(result);
}

function getDateFromWeekdayMessage(message) {
  const text = message.toLowerCase();

  const weekdays = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  };

  for (const [weekdayName, weekdayNumber] of Object.entries(weekdays)) {
    if (text.includes(weekdayName)) {
      const saysNextDay =
        text.includes(`next ${weekdayName}`) ||
        text.includes(`coming next ${weekdayName}`);

      return getUpcomingWeekday(weekdayNumber, saysNextDay);
    }
  }

  return null;
}

async function handleTeacherChat(req, res) {
  try {
    const { userId, message } = req.body;

    console.log(req.body);

     const currentDate = getMalaysiaDate();

    if (!userId || !message || !message.trim()) {
      return res.status(400).json({
        error: "userId and message are required"
      });
    }

    /*
    --------------------------------
    1. GET TEACHER INFORMATION
    --------------------------------
    */

    const [userInfo] = await schoolDb.query(
      `
      SELECT id, name, email, school_id
      FROM users
      WHERE id = ?
      `,
      [userId]
    );

    if (userInfo.length === 0) {
      return res.status(404).json({
        error: "Teacher not found"
      });
    }

    const teacherSchoolId = userInfo[0].school_id;

    if (!teacherSchoolId) {
      return res.status(400).json({
        error: "This teacher is not assigned to a school."
      });
    }

    /*
    --------------------------------
    2. GET TEACHER CLASSES
    --------------------------------
    */

    const [teacherClasses] = await schoolDb.query(
      `
      SELECT
        u.id AS teacher_id,
        u.name AS teacher_name,
        sc.id AS class_id,
        sc.class_name
      FROM users u
      JOIN class_user cu
        ON cu.user_id = u.id
      JOIN school_classes sc
        ON sc.id = cu.school_class_id
      WHERE u.id = ?
      `,
      [userId]
    );

    /*
    --------------------------------
    3. GET CLASS ATTENDANCE
    --------------------------------
    */

    const [classAttendanceInfo] = await schoolDb.query(
      `
      SELECT
        s.id AS student_id,
        s.name AS student_name,
        ca.subject,
        ca.status,
        ca.attendance_time,
        ca.grade,
        ca.class_name,
        u.id AS subject_teacher_id,
        u.name AS subject_teacher_name
      FROM class_attendances ca
      JOIN students s
        ON s.id = ca.student_id
      LEFT JOIN users u
        ON u.id = ca.teacher_id
      WHERE ca.class_name IN (
        SELECT sc.class_name
        FROM class_user cu
        JOIN school_classes sc
          ON sc.id = cu.school_class_id
        WHERE cu.user_id = ?
      )
      AND DATE(ca.attendance_time) >=
          DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      ORDER BY ca.attendance_time DESC
      `,
      [userId]
    );

    /*
    --------------------------------
    4. LOAD TEACHER CHAT HISTORY
    --------------------------------
    */

    const [chatHistoryRows] = await aiDb.query(
      `
      SELECT role, message
      FROM chat_messages
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 20
      `,
      [userId]
    );

    // SQL returns newest first, but Groq needs oldest first.
    const chatHistory = chatHistoryRows
      .reverse()
      .map((chat) => ({
        role: chat.role,
        content: chat.message
      }));

    /*
    --------------------------------
    5. SAVE CURRENT TEACHER MESSAGE
    --------------------------------
    */

    await aiDb.query(
      `
      INSERT INTO chat_messages
      (
        user_id,
        role,
        message
      )
      VALUES (?, 'user', ?)
      `,
      [userId, message.trim()]
    );

/*
--------------------------------
CHECK AND SAVE SCHOOL EVENT
--------------------------------
*/

console.log("CHECKING EVENT MESSAGE:", message);
console.log("TEACHER CLASSES:", teacherClasses);

let eventData = {
  is_event: false,
  title: null,
  event_date: null,
  details: null,
  target_class: null
};

try {
  const eventExtractionResponse = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "openai/gpt-oss-20b",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
You are a school event extraction system.

Current date: ${currentDate}
Timezone: Asia/Kuala_Lumpur

Determine whether the teacher's message contains information about:
- a future class
- an activity
- an event
- a test
- homework
- something students need to bring
- something parents need to know
- a school schedule change
- a reminder for a future day

Messages such as these are events:
- This Friday will have art class.
- This Friday we have art class.
- Students should bring extra clothes on Friday.
- Remember that next Monday is Sports Day.
- Tomorrow students need to bring a calculator.
- Inform parents that school ends early on Wednesday.
- On 22 July there will be a science test.

Return one valid JSON object only.

For an event:

{
  "is_event": true,
  "title": "Short title",
  "event_date": "YYYY-MM-DD",
  "details": "Complete details for parents",
  "target_class": null
}

For a non-event:

{
  "is_event": false,
  "title": null,
  "event_date": null,
  "details": null,
  "target_class": null
}

Important rules:
- Convert relative dates into an exact YYYY-MM-DD date.
- Keep instructions such as clothes, equipment, time and venue.
- Do not include markdown.
- Do not wrap the JSON in code fences.
- is_event must be a JSON boolean, not a string.
`
        },
        {
          role: "user",
          content: message.trim()
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  let rawEventText =
    eventExtractionResponse.data.choices?.[0]?.message?.content || "{}";

  console.log("RAW EVENT RESPONSE:", rawEventText);

  // Remove markdown code fences in case the model returns them.
  rawEventText = rawEventText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  eventData = JSON.parse(rawEventText);

  const calculatedWeekdayDate =
  getDateFromWeekdayMessage(message.trim());

if (calculatedWeekdayDate) {
  console.log(
    "OVERRIDING AI EVENT DATE:",
    eventData.event_date,
    "=>",
    calculatedWeekdayDate
  );

  eventData.event_date = calculatedWeekdayDate;
}

  console.log("PARSED EVENT DATA:", eventData);
} catch (eventError) {
  console.error(
    "EVENT EXTRACTION ERROR:",
    eventError.response?.data || eventError.message || eventError
  );
}

console.log("EVENT DATA:", eventData);

/*
--------------------------------
NORMALIZE EVENT DATA
--------------------------------
*/

const isEvent =
  eventData.is_event === true ||
  eventData.is_event === "true" ||
  eventData.is_event === 1;

const eventDate =
  typeof eventData.event_date === "string"
    ? eventData.event_date.trim()
    : null;

console.log("IS EVENT:", isEvent);
console.log("EVENT DATE:", eventDate);
console.log("NUMBER OF TEACHER CLASSES:", teacherClasses.length);

    /*
    --------------------------------
    6. BUILD DATABASE MEMORY
    --------------------------------
    */

    let userMemory = "";

    if (userInfo.length > 0) {
      userMemory = `
User Name: ${userInfo[0].name}
User Email: ${userInfo[0].email}
User ID: ${userInfo[0].id}
`;
    }

    let teacherMemory = "";

    teacherClasses.forEach((row) => {
      teacherMemory += `
Teacher: ${row.teacher_name}
Class ID: ${row.class_id}
Class: ${row.class_name}
`;
    });

    if (
    isEvent &&
    eventDate &&
    teacherClasses.length > 0
) {
  let targetClasses = teacherClasses;

  if (eventData.target_class) {
    const targetClassName = String(eventData.target_class)
      .trim()
      .toLowerCase();

    const matchedClasses = teacherClasses.filter((teacherClass) =>
      teacherClass.class_name
        .trim()
        .toLowerCase()
        .includes(targetClassName)
    );

    if (matchedClasses.length > 0) {
      targetClasses = matchedClasses;
    }
  }

  for (const teacherClass of targetClasses) {
    await aiDb.query(
      `
      INSERT INTO school_events
      (
        teacher_id,
        school_id,
        school_class_id,
        title,
        message,
        event_date
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        teacherSchoolId,
        teacherClass.class_id,
        eventData.title || "Class Announcement",
        eventData.details || message.trim(),
        eventDate
      ]
    );
  }

  const classNames = targetClasses
    .map((teacherClass) => teacherClass.class_name)
    .join(", ");

  const eventReply =
    `Okay, I saved "${eventData.title || "Class Announcement"}" ` +
    `for ${eventDate}. Parents of ${classNames} can ask about it.`;

  await aiDb.query(
    `
    INSERT INTO chat_messages
    (
      user_id,
      role,
      message
    )
    VALUES (?, 'assistant', ?)
    `,
    [userId, eventReply]
  );

  return res.json({
    reply: eventReply,
    eventSaved: true
  });
}

    let attendanceMemory = "";

    classAttendanceInfo.forEach((row) => {
      const status = String(row.status || "").toLowerCase();

      attendanceMemory += `
Date: ${formatDateForAI(row.attendance_time)}
Student ID: ${row.student_id}
Student: ${row.student_name}
Subject: ${row.subject}
Subject Teacher: ${row.subject_teacher_name || "Unknown"}
Class Attendance Status: ${row.status}
Attended Class: ${
  status === "present" || status === "late"
    ? "Yes"
    : "No"
}
Time: ${row.attendance_time}
Class: ${row.class_name}
Grade: ${row.grade}
`;
    });

   

    /*
    --------------------------------
    7. SEND HISTORY TO GROQ
    --------------------------------
    */

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "openai/gpt-oss-20b",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `
You are a helpful school AI assistant for teachers.

Current date in Malaysia: ${currentDate}
Timezone: Asia/Kuala_Lumpur

Current logged-in teacher:
${userMemory}

Teacher classes:
${teacherMemory || "No class assigned to this teacher."}

Recent class attendance from the last 7 days:
${attendanceMemory || "No class attendance recorded in the last 7 days."}

Conversation memory rules:
- The messages after this system message contain previous conversations with this teacher.
- Use previous messages when the teacher refers to something discussed earlier.
- Examples include:
  - "What did I tell you earlier?"
  - "Continue what we discussed."
  - "What was the event I mentioned?"
  - "Which student did we talk about?"
- Do not claim to remember information that is not present in the conversation history or database.
- Chat history is private to this logged-in teacher.
- Do not expose one teacher's chat history to another teacher or parent.

Attendance rules:
- The teacher may only ask about students in their assigned classes.
- Use the supplied class attendance records only.
- Use class_attendances data for class attendance questions.
- Carefully match the requested date.
- If the teacher asks about today, use records dated ${currentDate}.
- If the teacher asks about yesterday, use the previous calendar date.
- If the teacher gives a specific date, only use records from that date.
- Never use records from a different date.
- Status "Present" means attended.
- Status "Late" means attended but late.
- Status "Absent" means did not attend.
- Status "MC" means absent with a medical certificate.
- If the teacher asks who teaches a subject, use Subject Teacher.
- Do not invent attendance records, students, events or teachers.
`
          },

          // Previous teacher and assistant messages
          ...chatHistory,

          // Current teacher message
          {
            role: "user",
            content: message.trim()
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const aiReply =
      response.data.choices?.[0]?.message?.content ||
      "Sorry, I could not reply.";

      

    /*
    --------------------------------
    8. SAVE AI REPLY
    --------------------------------
    */

    await aiDb.query(
      `
      INSERT INTO chat_messages
      (
        user_id,
        role,
        message
      )
      VALUES (?, 'assistant', ?)
      `,
      [userId, aiReply]
    );

    return res.json({
      reply: aiReply
    });

  } catch (err) {
    console.error(
      "TEACHER CHAT ERROR:",
      err.response?.data || err.message || err
    );

    return res.status(500).json({
      error: "Teacher AI chat failed"
    });
  }
}

function formatEventDate(dateValue) {
  if (!dateValue) {
    return "-";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return String(dateValue);
  }

  return date.toLocaleDateString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

////////////////CHAT////////////////////////


app.post("/chat", async (req, res) => {
  try {
    const { email, userId, role, message } = req.body;

    console.log("CHAT REQUEST BODY:", req.body);

    // Teacher AI
    if (role === "teacher") {
      return handleTeacherChat(req, res);
    }

    // Parent AI
    if (!email || !message) {
      return res.status(400).json({
        message: "Email and message are required"
      });
    }

    // Find the school user by email
    const [users] = await schoolDb.query(
      `
      SELECT id
      FROM users
      WHERE email = ?
      LIMIT 1
      `,
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({
        reply: "No school account was found for this email."
      });
    }

    const parentUserId = users[0].id;

    console.log("Email:", email);
    console.log("School User ID:", parentUserId);

    const lowerMessage = message.toLowerCase();

    if (role === "teacher") {
      return handleTeacherChat(req, res);
    }

    // 1. Save user message
    await aiDb.query(
      "INSERT INTO chat_messages (user_id, role, message) VALUES (?, ?, ?)",
      [parentUserId, "user", message]
    );

    // 2. Get previous chat history
    const [history] = await aiDb.query(
      `
      SELECT role, message
      FROM chat_messages
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [parentUserId]
    );

    const chatHistory = history.reverse().map((msg) => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: msg.message,
    }));

    const [studentInfo] = await schoolDb.query(`
SELECT
    g.name AS guardian_name,
    g.type AS guardian_type,
    g.ic AS guardian_ic,
    g.phone AS guardian_phone,
    g.email AS guardian_email,

    s.id AS student_id,
    s.name AS student_name,
    s.class_name,
    s.grade,

    a.status AS attendance_status,
    a.check_in,
    a.check_out,
    a.date
FROM guardians g
JOIN students s
    ON g.student_id = s.id
LEFT JOIN attendances a
    ON a.student_id = s.id
    AND a.date = CURDATE()
WHERE g.email = (
    SELECT email
    FROM users
    WHERE id = ?
)
`, [parentUserId]);

// Detect whether parent wants to chat with a teacher
const wantsToChatWithTeacher =
  lowerMessage.includes("chat with") ||
  lowerMessage.includes("talk to") ||
  lowerMessage.includes("speak to") ||
  lowerMessage.includes("contact") ||
  lowerMessage.includes("message");

// Subject aliases
const subjectAliases = {
  mathematics: [
    "mathematics",
    "math",
    "maths",
    "matematik"
  ],

  "bahasa melayu": [
    "bahasa melayu",
    "bahasa malaysia",
    "bm",
    "malay"
  ],

  english: [
    "english",
    "bahasa inggeris",
    "bi"
  ],

  science: [
    "science",
    "sains"
  ],

  history: [
    "history",
    "sejarah"
  ],

  geography: [
    "geography",
    "geografi"
  ],

  "islamic education": [
    "islamic education",
    "pendidikan islam",
    "agama"
  ],

  "moral education": [
    "moral education",
    "pendidikan moral",
    "moral"
  ]
};

// Find which subject was mentioned
let requestedSubject = null;

for (const [subject, aliases] of Object.entries(subjectAliases)) {
  const found = aliases.some(alias =>
    lowerMessage.includes(alias.toLowerCase())
  );

  if (found) {
    requestedSubject = subject;
    break;
  }
}

if (
  wantsToChatWithTeacher &&
  requestedSubject &&
  studentInfo.length > 0
) {
  const student = studentInfo[0];

  student.student_id

  // Get all aliases for the detected subject.
  // Example: history -> ["history", "sejarah"]
  const aliases = subjectAliases[requestedSubject];

  const subjectConditions = aliases
    .map(() => "LOWER(TRIM(ca.subject)) LIKE ?")
    .join(" OR ");

  const subjectValues = aliases.map(
    alias => `%${alias.toLowerCase()}%`
  );

  const [subjectTeachers] = await schoolDb.query(
    `
    SELECT
      ca.teacher_id,
      ca.subject,
      u.name AS teacher_name
    FROM class_attendances ca
    JOIN users u
      ON u.id = ca.teacher_id
    WHERE ca.student_id = ?
      AND ca.teacher_id IS NOT NULL
      AND (${subjectConditions})
    ORDER BY ca.attendance_time DESC
    LIMIT 1
    `,
    [
      student.student_id,
      ...subjectValues
    ]
  );

  console.log("REQUESTED SUBJECT:", requestedSubject);
  console.log("SUBJECT ALIASES:", aliases);
  console.log("SUBJECT TEACHER RESULT:", subjectTeachers);

  if (subjectTeachers.length > 0) {
    const teacher = subjectTeachers[0];

    const aiReply =
      `Okay, I will connect you with ${teacher.teacher_name}, ` +
      `your child's ${teacher.subject} teacher.`;

    await aiDb.query(
      `
      INSERT INTO chat_messages (user_id, role, message)
      VALUES (?, ?, ?)
      `,
      [parentUserId, "assistant", aiReply]
    );

    return res.json({
      reply: aiReply,
      action: "OPEN_TEACHER_CHAT",
      teacher_id: teacher.teacher_id,
      student_id: student.student_id,
      teacher_name: teacher.teacher_name,
      subject: teacher.subject
    });
  }

  return res.json({
    reply:
      `I could not find the ${requestedSubject} teacher for ` +
      `${student.student_name}. Please make sure class attendance ` +
      `for that subject has already been recorded.`
  });
}

const [homeroomInfo] = await schoolDb.query(
  `
  SELECT
    s.id AS student_id,
    s.name AS student_name,
    s.class_name,
    sc.id AS school_class_id,
    u.school_id,
    u.id AS teacher_id,
    u.name AS teacher_name,
    u.email AS teacher_email
  FROM guardians g
  JOIN students s
    ON g.student_id = s.id
  JOIN school_classes sc
    ON sc.class_name = s.class_name
  JOIN class_user cu
    ON cu.school_class_id = sc.id
  JOIN users u
    ON u.id = cu.user_id
  WHERE g.email = (
    SELECT email
    FROM users
    WHERE id = ?
  )
  LIMIT 1
  `,
  [parentUserId]
);

let events = [];

if (studentInfo.length > 0 && homeroomInfo.length > 0) {
  const studentSchoolId = homeroomInfo[0].school_id;
  const studentClassId = homeroomInfo[0].school_class_id;

  const [eventRows] = await aiDb.query(
    `
    SELECT
      id,
      teacher_id,
      school_id,
      school_class_id,
      title,
      message,
      event_date,
      end_date
    FROM school_events
    WHERE school_id = ?
      AND (
        school_class_id IS NULL
        OR school_class_id = ?
      )
    ORDER BY event_date ASC
    `,
    [studentSchoolId, studentClassId]
  );

  console.log("EVENT ROWS FOUND:", eventRows);

  events = eventRows.map((event) => {
    const eventClassId =
      event.school_class_id === null
        ? null
        : Number(event.school_class_id);

    return {
      ...event,

      class_name:
        eventClassId === studentClassId
          ? homeroomInfo[0].class_name
          : null,

      teacher_name:
        Number(event.teacher_id) ===
        Number(homeroomInfo[0].teacher_id)
          ? homeroomInfo[0].teacher_name
          : "Unknown",

      event_scope:
        eventClassId === null
          ? "school"
          : "class"
    };
  });

  console.log("FINAL EVENTS SENT TO AI:", events);
} else {
  console.log("NO HOMEROOM INFORMATION FOUND:", {
    studentInfoCount: studentInfo.length,
    homeroomInfoCount: homeroomInfo.length
  });
}

const [classAttendanceInfo] = await schoolDb.query(`
SELECT
    s.name AS student_name,
    ca.subject,
    ca.status,
    ca.attendance_time,
    ca.grade,
    ca.class_name
FROM guardians g
JOIN students s
    ON g.student_id = s.id
JOIN class_attendances ca
    ON ca.student_id = s.id
WHERE g.email = (
    SELECT email
    FROM users
    WHERE id = ?
)
AND DATE(ca.attendance_time) = CURDATE()
ORDER BY ca.attendance_time DESC
`, [parentUserId]);

    // 3. Get user memory
    const [memories] = await aiDb.query(
      `
      SELECT memory_key, memory_value
      FROM user_memory
      WHERE user_id = ?
      `,
      [parentUserId]
    );

    const memoryText = memories
      .map((m) => `${m.memory_key}: ${m.memory_value}`)
      .join("\n");


      let schoolMemory = "";

studentInfo.forEach((row) => {
  schoolMemory += `
Guardian: ${row.guardian_name}
Guardian Type: ${row.guardian_type}
Child: ${row.student_name}
Class: ${row.class_name}
Grade: ${row.grade}
Attendance Today: ${row.attendance_status || "No attendance recorded"}
Check In: ${row.check_in || "-"}
Check Out: ${row.check_out || "-"}
`;
});

let homeroomMemory = "";

homeroomInfo.forEach((row) => {
  homeroomMemory += `
Child: ${row.student_name}
Homeroom Teacher: ${row.teacher_name}
Teacher Email: ${row.teacher_email}
Class: ${row.class_name}
`;
});

let eventMemory = "";

events.forEach((event, index) => {
  const startDate = formatEventDate(event.event_date);
  const endDate = formatEventDate(event.end_date);

  const dateText =
    event.end_date && endDate !== startDate
      ? `${startDate} until ${endDate}`
      : startDate;

  const scopeText =
    event.event_scope === "school"
      ? "Whole School"
      : `Class ${event.class_name}`;

  eventMemory += `
Event ${index + 1}
Title: ${event.title}
Date: ${dateText}
Scope: ${scopeText}
Details: ${event.message || "-"}
Teacher: ${event.teacher_name || "School Administration"}

`;
});

let classAttendanceMemory = "";

classAttendanceInfo.forEach((row) => {
  classAttendanceMemory += `
Subject: ${row.subject}
Class Attendance Status: ${row.status}
Attended Class: ${row.status === "Present" || row.status === "Late" ? "Yes" : "No"}
Time: ${row.attendance_time}
Class: ${row.class_name}
Grade: ${row.grade}
`;
});

const wantsTeacherChat =
  lowerMessage.includes("chat with") ||
  lowerMessage.includes("message teacher") ||
  lowerMessage.includes("contact teacher") ||
  lowerMessage.includes("homeroom teacher") ||
  lowerMessage.includes("guru kelas");

if (wantsTeacherChat) {
  if (homeroomInfo.length === 0) {
    return res.json({
      reply: "Sorry, I could not find your child’s homeroom teacher.",
      action: null
    });
  }

  const teacher = homeroomInfo[0];

  const aiReply = `Yes, I can connect you with ${teacher.teacher_name}, your child’s homeroom teacher.`;

  await aiDb.query(
    "INSERT INTO chat_messages (user_id, role, message) VALUES (?, ?, ?)",
    [parentUserId, "assistant", aiReply]
  );

  return res.json({
  reply: `Yes, I’ll open a chat with ${teacher.teacher_name}, your child’s homeroom teacher.`,
  action: "OPEN_TEACHER_CHAT",
  teacher_id: teacher.teacher_id,
  teacher_name: teacher.teacher_name,
  student_id: teacher.student_id
});
}
    // 4. Send to Groq
    // 4. Send to Groq
const response = await axios.post(
  "https://api.groq.com/openai/v1/chat/completions",
  {
    model: "openai/gpt-oss-20b",
    messages: [
  {
    role: "system",
    content: `
You are a helpful school system AI assistant.

Known user memory:
${memoryText || "No saved memory yet."}

School information:
${schoolMemory || "No linked student found for this user."}

Homeroom teacher information:
${homeroomMemory || "No homeroom teacher information found."}

Today's class attendance:
${classAttendanceMemory || "No class attendance has been recorded today."}

Recorded school and class events:

${eventMemory || "No school or class events have been recorded."}

Rules:
-  If today's class attendance count is 0, and parent asks "did my child attend class today?", answer: "No, your child did not attend any class today."
- "Attend school" means data from attendances table only.
- "Attend class" means data from class_attendances table only.
- If parent asks about a subject, only check Today's class attendance.
- Do not use school attendance to answer class/subject attendance.
- If the subject is not found in Today's class attendance, say the child did not attend that class today.
- For class attendance, status "Present" means attended.
- Status "Late" also means attended, but late.
- Status "Absent" means did not attend.
- Status "MC" means absent with medical certificate.
- Status "Unwell" means not attending normally because unwell.
- If parent asks about a subject and the subject exists with status "Late", answer: "Yes, your child attended [subject], but was late."
- Do not say "No" if the class attendance status is "Late".
- If the parent asks about Friday, Monday, tomorrow, next week, activities, reminders, or what to bring, answer using these events.
- If an event exists, never say you don't know.

Event rules:
- The supplied events include whole-school events and events specifically for the child's class.
- An event marked "Whole School" applies to every student in the school.
- An event marked with a class applies only to that class.
- When the parent asks for school events, include whole-school events.
- When the parent asks for class events, include events for the child's class.
- When the parent asks for all events, include both whole-school and relevant class events.
- When the parent asks for events this year, include matching past and future events in the current calendar year.
- When the parent asks for upcoming events, include only events dated today or later.
- Include the event title, date, scope and important instructions.
- Do not invent events.
- If no matching event exists, clearly say that no event is recorded for the requested period.

Event response formatting rules:
- Present multiple events as a numbered list.
- Put each event on separate lines.
- Use this format:

1. Event Title
   Date: 5 January 2026
   Scope: Whole School
   Details: Event details

- For date ranges, write: 17 February 2026 until 18 February 2026.
- Do not show JavaScript date values, timestamps, GMT text or timezone text.
- Do not place all events in one paragraph.
- Do not include the teacher name unless the parent asks who created the event.
- Keep each event concise and easy to read.
    `,
  },
  ...chatHistory,
  {
    role: "user",
    content: message,
  },
],
  },
  {
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
  }
);

const data = response.data;

    const aiReply = data.choices?.[0]?.message?.content || "Sorry, I could not reply.";

    // 5. Save AI reply
    await aiDb.query(
      "INSERT INTO chat_messages (user_id, role, message) VALUES (?, ?, ?)",
      [parentUserId, "assistant", aiReply]
    );

    res.json({ reply: aiReply });

  } catch (error) {
  console.error("CHAT ERROR FULL:", error);
  console.error("CHAT ERROR MESSAGE:", error.message);
  console.error("CHAT ERROR SQL:", error.sql);
  console.error("CHAT ERROR RESPONSE:", error.response?.data);

  return res.status(500).json({
    error: "AI chat failed",
    message: error.message,
    sqlMessage: error.sqlMessage || null,
    groqError: error.response?.data || null
  });
}
});

app.get(
  "/teacher-parent-messages/:teacherUserId/:parentId/:studentId",
  async (req, res) => {
    try {
      const {
        teacherUserId,
        parentId,
        studentId
      } = req.params;

      const [messages] = await aiDb.query(
        `
        SELECT
          id,
          parent_user_id,
          teacher_user_id,
          student_id,
          sender_role,
          message,
          attachment_name,
          attachment_path,
          attachment_type,
          document_id,
          is_read,
          created_at
        FROM parent_teacher_messages
        WHERE teacher_user_id = ?
          AND parent_user_id = ?
          AND student_id = ?
        ORDER BY created_at ASC
        `,
        [
          teacherUserId,
          parentId,
          studentId
        ]
      );

      res.json(messages);
    } catch (error) {
      console.error(
        "LOAD TEACHER MESSAGES ERROR:",
        error
      );

      res.status(500).json({
        error: "Failed to load messages."
      });
    }
  }
);

///////////////////POST PARENT TEACHER MESSAGES////////////////////

app.post('/parent-teacher-messages', async (req, res) => {
  try {
    const {
      parentEmail,
      teacherId,
      studentId,
      senderRole,
      message
    } = req.body;

    console.log('New chat message:', req.body);

    if (
      !parentEmail ||
      !teacherId ||
      !studentId ||
      !senderRole ||
      !message ||
      !String(message).trim()
    ) {
      return res.status(400).json({
        message:
          'parentEmail, teacherId, studentId, senderRole and message are required'
      });
    }

    if (
      senderRole !== 'parent' &&
      senderRole !== 'teacher'
    ) {
      return res.status(400).json({
        message: 'Invalid sender role'
      });
    }

    const cleanParentEmail = String(parentEmail)
      .trim()
      .toLowerCase();

    const [parentRows] = await schoolDb.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(TRIM(email)) = ?
      LIMIT 1
      `,
      [cleanParentEmail]
    );

    if (parentRows.length === 0) {
      return res.status(404).json({
        message: 'Parent account not found'
      });
    }

    const [teacherRows] = await schoolDb.query(
      `
      SELECT id
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [Number(teacherId)]
    );

    if (teacherRows.length === 0) {
      return res.status(404).json({
        message: 'Teacher account not found'
      });
    }

    const parentUserId = parentRows[0].id;
    const teacherUserId = teacherRows[0].id;

    const [result] = await aiDb.query(
      `
      INSERT INTO parent_teacher_messages
      (
        parent_user_id,
        teacher_user_id,
        student_id,
        sender_role,
        message,
        is_read,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, 0, NOW())
      `,
      [
        parentUserId,
        teacherUserId,
        Number(studentId),
        senderRole,
        String(message).trim()
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      messageId: result.insertId
    });
  } catch (error) {
    console.error(
      'SEND PARENT TEACHER MESSAGE ERROR:',
      error
    );

    return res.status(500).json({
      message: 'Failed to send message',
      error: error.message
    });
  }
});

/////////////////PARENT-TEACHER-MESSAGES//////////////////

app.get('/parent-teacher-messages', async (req, res) => {
  try {
    const {
      parentEmail,
      teacherId,
      studentId
    } = req.query;

    if (!parentEmail || !teacherId || !studentId) {
      return res.status(400).json({
        message:
          'parentEmail, teacherId and studentId are required'
      });
    }

    const cleanParentEmail = String(parentEmail)
      .trim()
      .toLowerCase();

    const [parentRows] = await schoolDb.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(TRIM(email)) = ?
      LIMIT 1
      `,
      [cleanParentEmail]
    );

    if (parentRows.length === 0) {
      return res.status(404).json({
        message: 'Parent account not found'
      });
    }

    const [teacherRows] = await schoolDb.query(
      `
      SELECT id
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [Number(teacherId)]
    );

    if (teacherRows.length === 0) {
      return res.status(404).json({
        message: 'Teacher account not found'
      });
    }

    const parentUserId = parentRows[0].id;
    const teacherUserId = teacherRows[0].id;

    const [messages] = await aiDb.query(
      `
      SELECT
        id,
        parent_user_id,
        teacher_user_id,
        student_id,
        sender_role,
        message,
        is_read,
        created_at
      FROM parent_teacher_messages
      WHERE parent_user_id = ?
        AND teacher_user_id = ?
        AND student_id = ?
      ORDER BY created_at ASC, id ASC
      `,
      [
        parentUserId,
        teacherUserId,
        Number(studentId)
      ]
    );

    return res.json(messages);
  } catch (error) {
    console.error(
      'LOAD PARENT TEACHER MESSAGES ERROR:',
      error
    );

    return res.status(500).json({
      message: 'Failed to load messages',
      error: error.message
    });
  }
});

///////////////////TEACHER ///////////////////////////

app.get("/teachers/:teacherId", async (req, res) => {
  try {
    const { teacherId } = req.params;

    const [teacher] = await schoolDb.query(
      `
      SELECT
        id,
        name,
        email
      FROM users
      WHERE id = ?
      `,
      [teacherId]
    );

    if (teacher.length === 0) {
      return res.status(404).json({
        error: "Teacher not found"
      });
    }

    res.json(teacher[0]);

  } catch (err) {
    console.error("GET TEACHER ERROR:", err);
    res.status(500).json({
      error: "Failed to get teacher"
    });
  }
});

////////////TEACHER BY EMAIL ////////////////////

app.get("/teacher-by-email", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        message: "Email is required"
      });
    }

    const [teachers] = await schoolDb.query(
      `
      SELECT DISTINCT
        u.id,
        u.name,
        u.email
      FROM users u
      JOIN class_user cu
        ON cu.user_id = u.id
      WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(?))
      LIMIT 1
      `,
      [email]
    );

    if (teachers.length === 0) {
      return res.status(404).json({
        message: "This user is not a teacher"
      });
    }

    return res.json(teachers[0]);
  } catch (error) {
    console.error("GET TEACHER BY EMAIL ERROR:", error);

    return res.status(500).json({
      message: "Failed to check teacher account",
      error: error.message
    });
  }
});

app.get("/parent-school-teachers", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim();

    if (!email) {
      return res.status(400).json({
        message: "Parent email is required."
      });
    }

    /*
     * Find the parent's child and school.
     */
    const [children] = await schoolDb.query(
      `
      SELECT
        s.id AS student_id,
        s.name AS student_name,
        s.class_name AS student_class_name,
        s.school_id
      FROM guardians g
      JOIN students s
        ON s.id = g.student_id
      WHERE LOWER(TRIM(g.email)) = LOWER(TRIM(?))
      `,
      [email]
    );

    if (children.length === 0) {
      return res.status(404).json({
        message: "No child was found for this parent."
      });
    }

    const teacherResults = [];

    for (const child of children) {
      const [teachers] = await schoolDb.query(
        `
        SELECT
          u.id AS user_id,
          u.teacher_id,
          u.name AS teacher_name,
          u.email AS teacher_email,
          u.school_id,

          ? AS student_id,
          ? AS student_name,
          ? AS student_class_name,

          'teacher' AS teacher_type,

          NULL AS subject,
          NULL AS profile_image,
          NULL AS last_message,
          NULL AS last_message_time,
          0 AS unread_count
        FROM users u
        WHERE u.school_id = ?
          AND u.teacher_id IS NOT NULL
        ORDER BY u.name ASC
        `,
        [
          child.student_id,
          child.student_name,
          child.student_class_name,
          child.school_id
        ]
      );

      teacherResults.push(...teachers);
    }

    /*
     * Prevent duplicate teacher entries.
     */
    const uniqueTeachers = [];
    const teacherKeys = new Set();

    for (const teacher of teacherResults) {
      const key =
        `${teacher.user_id}-${teacher.student_id}`;

      if (!teacherKeys.has(key)) {
        teacherKeys.add(key);
        uniqueTeachers.push(teacher);
      }
    }

    return res.json(uniqueTeachers);
  } catch (error) {
    console.error(
      "PARENT SCHOOL TEACHERS ERROR:",
      error
    );

    return res.status(500).json({
      message: "Failed to load teachers.",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`Groq backend running on http://localhost:${PORT}`);
});