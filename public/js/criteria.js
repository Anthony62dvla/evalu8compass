/*
 * How Well Are We Doing? — criteria library
 * ------------------------------------------------------------
 * Every expectation in the checklist lives here. Edit this file to add,
 * remove or reword criteria; the UI picks changes up automatically.
 *
 * Item fields
 *   id       stable, unique key (answers are saved against it — never reuse an id)
 *   t        the expectation. A string, or {all, maintained, academy, independent}
 *   e        evidence an inspector would expect to see. String or per-type object
 *   ref      statutory / guidance reference. String or per-type object (optional)
 *   types    school types it applies to (default: all three)
 *   phases   phases it applies to (default: all). eyfs ks1 ks2 ks3 ks4 p16
 *   special  true = only shown when "Specialist provision" is switched on
 *
 * Area fields
 *   icon     icon name from public/js/icons.js shown in the area's tile
 *   phases   whole area hidden unless one of these phases is selected
 *   judged   "metnotmet" for safeguarding (not graded on the 5-point scale)
 *   fallback offline improvement ideas used when no AI inspector is connected
 */
(function (root) {
  const ALL = ["maintained", "academy", "independent"];
  const STATE = ["maintained", "academy"];
  const IND = ["independent"];
  const AC_IND = ["academy", "independent"];
  const PRIMARY = ["eyfs", "ks1", "ks2"];
  const SECONDARY = ["ks3", "ks4"];
  const SCHOOL_AGE = ["ks1", "ks2", "ks3", "ks4"];

  const SCHOOL_TYPES = [
    { id: "maintained", label: "Maintained", hint: "LA-maintained, foundation, voluntary aided/controlled" },
    { id: "academy", label: "Academy / free school", hint: "Single or multi-academy trust, free school, UTC, studio school" },
    { id: "independent", label: "Independent", hint: "Ofsted-inspected independent, incl. independent special" },
  ];

  const PHASES = [
    { id: "eyfs", label: "EYFS", hint: "Nursery and Reception" },
    { id: "ks1", label: "KS1", hint: "Years 1–2" },
    { id: "ks2", label: "KS2", hint: "Years 3–6" },
    { id: "ks3", label: "KS3", hint: "Years 7–9" },
    { id: "ks4", label: "KS4", hint: "Years 10–11" },
    { id: "p16", label: "Post-16", hint: "Sixth form, Years 12–13+" },
  ];

  const AREAS = [
    {
      id: "sg", icon: "shield-check", name: "Safeguarding", judged: "metnotmet",
      sub: "Judged Met, Not met or Insufficient evidence",
      fallback: [
        "Run a safeguarding culture survey with all staff (including support and site staff) and act on the themes.",
        "Audit the single central record line by line against KCSIE Part 3 with a governor or trustee present.",
        "Sample ten recent concerns and check each was logged, escalated and closed with a clear outcome.",
        "Hold pupil voice sessions on feeling safe, online safety and trusted adults; feed findings into the curriculum.",
      ],
      items: [
        { id: "sg-culture", t: "Everyone knows how to raise a safeguarding concern, including low-level concerns about adults", e: "Staff conversations; low-level concerns policy and log", ref: "KCSIE Parts 1 and 4" },
        { id: "sg-dsl", t: "The DSL and deputies are trained, refreshed every two years and have time to do the role", e: "Training certificates; DSL job description; timetable allocation", ref: "KCSIE Part 2, Annex C" },
        { id: "sg-follow", t: "Concerns are recorded, acted on and followed through, with timely referrals to children's social care and the LADO", e: "Chronologies; referral records and outcomes" },
        { id: "sg-earlyhelp", t: "Pupils who need early help are identified quickly and the school works well with other agencies", e: "Early help records; multi-agency meeting notes", ref: "Working Together to Safeguard Children 2023" },
        { id: "sg-scr", t: "The single central record is complete and accurate for all staff, volunteers and those in governance", e: "SCR audit; recruitment files",
          ref: { maintained: "KCSIE Part 3", academy: "KCSIE Part 3; ISS Part 4", independent: "KCSIE Part 3; ISS Part 4, paras 18–21" } },
        { id: "sg-s128", t: "Section 128 checks are completed and dated for everyone in a management or proprietor role", e: "SCR entries with check dates", ref: "ISS paras 18(2), 20(6), 21(3), 21(6)", types: AC_IND },
        { id: "sg-gov", t: { maintained: "Governors are trained and a named safeguarding governor scrutinises practice", academy: "Trustees and local governors are trained, with a named safeguarding link who scrutinises practice", independent: "The proprietor is trained in safeguarding and scrutinises practice independently of school leaders" },
          e: "Governance minutes; annual safeguarding report; link visit notes", ref: "KCSIE Part 2" },
        { id: "sg-filter", t: "Filtering and monitoring meet DfE standards and are reviewed at least annually", e: "Filtering and monitoring review; alert logs; named lead", ref: "DfE filtering and monitoring standards; KCSIE" },
        { id: "sg-pupils", t: "Pupils feel safe, can name a trusted adult and are taught how to keep themselves safe, including online", e: "Pupil voice; surveys; curriculum map" },
        { id: "sg-cme", t: "Absence and removal from roll are treated as possible safeguarding risks, with the local authority notified as required", e: "Children missing education procedure; LA notifications", ref: "School Attendance (Pupil Registration) (England) Regulations 2024" },
        { id: "sg-ap", t: "Off-site visits and any alternative provision are risk-assessed, and placements are checked and visited", e: "Visit risk assessments; AP quality checks and attendance", ref: "KCSIE; DfE alternative provision guidance" },
        { id: "sg-prevent", t: "The Prevent duty is met with a current risk assessment and trained staff", e: "Prevent risk assessment; training records", ref: "Prevent duty guidance" },
        { id: "sg-intimate", t: "Intimate care and positive handling plans are agreed with families and followed", e: "Intimate care plans; positive handling plans; RPI records", ref: "DfE use of reasonable force guidance", special: true },
        { id: "sg-eyfs", t: "Early years safeguarding and welfare requirements are met, including paediatric first aid and safer eating", e: "First aid certificates; supervision of eating; allergy records", ref: "EYFS statutory framework, Section 3", phases: ["eyfs"] },
      ],
    },
    {
      id: "inc", icon: "users", name: "Inclusion",
      sub: "How well the school identifies and meets the needs of disadvantaged pupils and pupils with SEND",
      fallback: [
        "Map every pupil with SEND or an EHC plan against their current support, and check staff can access each plan.",
        "Commission specialist input (SALT, OT, educational psychology) for the needs most common on roll.",
        "Build a training matrix for the needs you serve and close the biggest gap this term.",
        "Run a case-study review of three disadvantaged pupils to test whether support is changing outcomes.",
      ],
      items: [
        { id: "inc-identify", t: "Leaders identify pupils who are disadvantaged or have SEND early and understand their barriers", e: "SEND register; disadvantaged tracking; entry screening" },
        { id: "inc-senco", t: { all: "A qualified SENCo leads SEND provision, with the NPQ for SENCos or working towards it", independent: "A suitably experienced, named lead oversees SEND provision" },
          e: "SENCo qualification; role and time allocation", ref: { maintained: "SEND Code of Practice 6.84–6.94", academy: "SEND Code of Practice 6.84–6.94" } },
        { id: "inc-report", t: "The SEN information report and SEND policy are current and published", e: "Website; policy review date", ref: "Children and Families Act 2014 s69; SEND Regulations 2014", types: STATE },
        { id: "inc-ehcp", t: "Staff can access each pupil's EHC plan or support plan and use it to adapt teaching", e: "Plan audit; lesson planning showing adaptations" },
        { id: "inc-outcomes", t: "Progress towards EHC plan outcomes is tracked and feeds annual reviews", e: "Outcome tracking; annual review paperwork", ref: "SEND Code of Practice, Chapter 9" },
        { id: "inc-specialist", t: "Specialist help (speech and language, OT, educational psychology, CAMHS) is sourced when pupils need it", e: "Service agreements; therapy records" },
        { id: "inc-training", t: "Staff are trained for the needs on roll, such as SLCN, autism, SEMH and SLD", e: "Training matrix; CPD records" },
        { id: "inc-admit", t: { maintained: "Admissions follow the School Admissions Code and the school can meet the needs of pupils it takes", academy: "Admissions follow the School Admissions Code and funding agreement, and the school can meet the needs of pupils it takes", independent: "Pupils admitted match the school's registration, and any material change (age range, capacity, type of SEN) is approved by the DfE first" },
          e: "Admissions policy; registration details; DfE correspondence", ref: { maintained: "School Admissions Code", academy: "School Admissions Code; funding agreement", independent: "Education and Skills Act 2008 s162" } },
        { id: "inc-pp", t: "Pupil premium is spent on evidence-informed approaches and the strategy statement is published", e: "Pupil premium strategy statement; impact review", ref: "Pupil premium conditions of grant", types: STATE },
        { id: "inc-cla", t: "A designated teacher supports looked-after and previously looked-after pupils, with high-quality PEPs", e: "Designated teacher role; PEPs; virtual school contact",
          ref: { maintained: "Designated teacher statutory guidance", academy: "Designated teacher statutory guidance", independent: "Virtual school and PEP expectations" } },
        { id: "inc-access", t: "The accessibility plan is current and its objectives are being acted on", e: "Accessibility plan; progress against objectives", ref: "Equality Act 2010, Schedule 10" },
        { id: "inc-groups", t: "Pupils with EAL, young carers and pupils known to social care are identified and supported", e: "Group tracking; support records" },
        { id: "inc-exclusion", t: "Suspensions and exclusions are lawful, recorded and analysed for disproportionality", e: "Exclusion log; analysis by group", ref: "Suspension and permanent exclusion guidance", types: STATE },
        { id: "inc-comm", t: "A consistent total communication approach supports non-verbal pupils", e: "Communication policy; symbols/AAC in use; staff training", special: true },
      ],
    },
    {
      id: "ct", icon: "book", name: "Curriculum and teaching",
      sub: "What pupils are taught and how well it is taught",
      fallback: [
        "Write or refresh a curriculum map with clear end points for each year group or pathway.",
        "Run joint learning walks focused on one subject and give staff specific feedback within a week.",
        "Choose one assessment-for-learning technique to embed across all classes this half-term.",
        "Audit reading: who can't read fluently yet, and what catch-up are they getting?",
      ],
      items: [
        { id: "ct-coherent", t: "The curriculum is ambitious and coherently sequenced, with clear end points", e: "Curriculum maps; long and medium-term plans",
          ref: { maintained: "National curriculum (statutory)", academy: "Funding agreement: broad and balanced curriculum", independent: "ISS Part 1, para 2(1)" } },
        { id: "ct-breadth", t: { maintained: "Pupils study the full national curriculum, plus RE and RSHE", academy: "The curriculum is broad and balanced, including English, maths, science, RE and RSHE", independent: "The curriculum covers linguistic, mathematical, scientific, technological, human and social, physical, and aesthetic and creative education" },
          e: "Curriculum policy; timetable", ref: { maintained: "Education Act 2002 s78–80", academy: "Funding agreement", independent: "ISS Part 1, para 2(2)(a)" } },
        { id: "ct-send", t: "The curriculum is adapted for pupils with SEND without lowering ambition", e: "Adapted plans; pathway documents" },
        { id: "ct-strategic", t: "There is clear strategic leadership of the curriculum, reviewed regularly", e: "Named curriculum lead; review cycle; subject leader reports" },
        { id: "ct-phonics", t: "A DfE-validated systematic synthetic phonics programme is taught with fidelity from Reception", e: "Phonics programme; fidelity checks; staff training", ref: "The reading framework (DfE)", phases: ["eyfs", "ks1"] },
        { id: "ct-catchup", t: "Pupils who fall behind in reading, including older pupils, get rapid and effective catch-up", e: "Reading assessments; intervention records", phases: ["ks1", "ks2", "ks3", "ks4"] },
        { id: "ct-maths", t: "Early mathematics builds fluency in number facts, with times tables secure by the end of Year 4", e: "Maths planning; fluency checks", ref: "Multiplication tables check (Year 4)", phases: PRIMARY },
        { id: "ct-knowledge", t: "Teachers have strong subject knowledge, and CPD closes any gaps", e: "CPD plan; subject leader monitoring" },
        { id: "ct-assess", t: "Teachers check understanding, spot misconceptions and adapt teaching, without excessive workload", e: "Lesson visits; assessment policy", ref: { independent: "ISS Part 1, para 3(g)" } },
        { id: "ct-lessons", t: "Lessons are well planned, with effective use of time and good-quality resources", e: "Lesson visits; resource audit", ref: { independent: "ISS Part 1, para 3(c), 3(f)" } },
        { id: "ct-comm", t: "Communication, language and vocabulary are deliberately developed across the curriculum", e: "Vocabulary planning; oracy approach" },
        { id: "ct-reading", t: "Pupils read widely and often, and reading for pleasure is promoted", e: "Reading spine; library use; pupil voice" },
        { id: "ct-offsite", t: "Off-site and community activities are planned with learning intentions linked to the curriculum", e: "Trip plans with objectives" },
        { id: "ct-ebacc", t: "Key stage 4 options keep a strong academic core, in line with the EBacc ambition", e: "Options data; EBacc entry", ref: "DfE EBacc ambition", phases: ["ks4"], types: STATE },
        { id: "ct-parttime", t: "Any reduced or part-time timetable is temporary, reviewed and agreed with parents and the local authority", e: "Part-time timetable register; review dates", ref: "Working together to improve school attendance" },
      ],
    },
    {
      id: "ach", icon: "trending-up", name: "Achievement",
      sub: "How well pupils learn and what they achieve",
      fallback: [
        "Agree one baseline assessment for new pupils and apply it to everyone joining from now on.",
        "Set up a simple tracker showing progress through the curriculum, not just test scores.",
        "Hold pupil progress meetings each half-term that end with named actions for named pupils.",
        "Compare outcomes for disadvantaged and SEND pupils with their peers and set a target to narrow the gap.",
      ],
      items: [
        { id: "ach-baseline", t: "Starting points are assessed when pupils join", e: "Baseline assessments; entry profiles" },
        { id: "ach-track", t: "Leaders know how well pupils learn the curriculum, with progress tracked over time", e: "Tracking system; assessment records", ref: { independent: "ISS Part 1, para 4" } },
        { id: "ach-statutory", t: "Statutory assessment results (EYFSP, phonics check, multiplication check, KS2) are analysed by group and acted on", e: "Assessment analysis; action plans", phases: PRIMARY },
        { id: "ach-ks4", t: { all: "KS4 outcomes (Progress 8, Attainment 8, English and maths) are analysed and acted on", independent: "GCSE or equivalent outcomes are analysed by subject and group and acted on" }, e: "Results analysis; department reviews", phases: ["ks4"] },
        { id: "ach-ehcp", t: "Pupils with EHC plans make progress towards their outcomes", e: "EHCP outcome tracking" },
        { id: "ach-disadv", t: "The attainment gap for disadvantaged pupils is narrowing", e: "Disadvantaged outcomes over three years", types: STATE },
        { id: "ach-reading", t: "Pupils read fluently for their age, with reading ages tracked", e: "Reading ages; fluency assessments", phases: SCHOOL_AGE },
        { id: "ach-work", t: "Pupils' work or learning journals show progression over time against curriculum intentions", e: "Book looks; annotated journals" },
        { id: "ach-next", t: "Pupils are well prepared for their next stage, and destinations are tracked", e: "Transition plans; destinations data" },
      ],
    },
    {
      id: "ab", icon: "calendar-check", name: "Attendance and behaviour",
      sub: "Attendance, punctuality, behaviour and attitudes",
      fallback: [
        "Spot-check a week of attendance codes against recorded reasons, and retrain staff on any errors.",
        "Name a senior attendance champion and set up a weekly attendance meeting with clear actions.",
        "Analyse behaviour logs by time, place and pupil to find patterns, then adjust support plans.",
        "Survey pupils on bullying and act on the hotspots they identify.",
      ],
      items: [
        { id: "ab-admreg", t: "The admissions register is accurate and up to date", e: "Register audit", ref: { all: "Pupil Registration Regulations 2024", independent: "ISS Part 3, para 15; Pupil Registration Regulations 2024" } },
        { id: "ab-attreg", t: "The attendance register uses the correct codes, morning and afternoon", e: "Code spot-checks; staff training on codes", ref: { all: "Pupil Registration Regulations 2024", independent: "ISS Part 3, para 15; Pupil Registration Regulations 2024" } },
        { id: "ab-wt", t: "The school follows 'Working together to improve school attendance', with a senior attendance champion", e: "Attendance policy; named champion; LA liaison", ref: "Working together to improve school attendance (statutory, Aug 2024)" },
        { id: "ab-daily", t: "Daily attendance data is shared with the DfE", e: "MIS data-sharing setting", ref: "Working together to improve school attendance", types: STATE },
        { id: "ab-pa", t: "Persistent and severe absence are analysed by group, with individual support plans", e: "Absence analysis; attendance plans" },
        { id: "ab-policy", t: "The behaviour policy is clear, known by pupils and applied consistently", e: "Behaviour policy; pupil and staff voice", ref: "Behaviour in schools guidance" },
        { id: "ab-log", t: "Behaviour incidents are logged and analysed, and trends inform support", e: "Incident logs; trend analysis" },
        { id: "ab-rpi", t: "Restrictive physical intervention is recorded, reported to parents and reducing over time", e: "RPI log; parent notifications", ref: "DfE use of reasonable force guidance" },
        { id: "ab-bully", t: "Bullying, including prejudice-based and online bullying, is recorded and tackled", e: "Bullying log; pupil surveys", ref: "Preventing and tackling bullying; Equality Act 2010" },
        { id: "ab-attitudes", t: "Low-level disruption is rare and pupils have positive attitudes to learning", e: "Lesson visits; pupil voice" },
        { id: "ab-phones", t: "A mobile phone policy is in place and enforced", e: "Policy; incident records", ref: "DfE mobile phones in schools guidance" },
        { id: "ab-plans", t: "Risk assessments and behaviour support plans for pupils with complex needs are followed consistently", e: "Behaviour support plans; observations", special: true },
      ],
    },
    {
      id: "pd", icon: "heart-handshake", name: "Personal development and wellbeing",
      sub: "Character, wellbeing, health, RSHE, careers and wider opportunities",
      fallback: [
        "Map PSHE and RSHE content against statutory guidance and fill the gaps in a written scheme.",
        "Plan how fundamental British values are taught, not just displayed, in each year group.",
        "Track who takes part in clubs and trips, and target disadvantaged pupils who don't.",
        "Review individual healthcare plans and medicines records with the school nurse or a first aider.",
      ],
      items: [
        { id: "pd-rshe", t: { all: "Relationships education (primary), RSE (secondary) and health education are taught to a planned curriculum", independent: "Relationships education (primary) and RSE (secondary) are taught to a planned curriculum" },
          e: "RSHE policy and scheme; delivery records", ref: { all: "RSHE statutory guidance", independent: "ISS para 2A; RSHE statutory guidance" }, phases: SCHOOL_AGE },
        { id: "pd-pshe", t: "A planned and sequenced PSHE curriculum is delivered", e: "PSHE scheme; timetable; pupil work", ref: { independent: "ISS Part 1, para 2(2)(d)" } },
        { id: "pd-fbv", t: "Fundamental British values are actively promoted", e: "Curriculum map; activities; pupil voice", ref: { maintained: "Promoting fundamental British values as part of SMSC (DfE)", academy: "ISS Part 2, para 5", independent: "ISS Part 2, para 5" } },
        { id: "pd-smsc", t: "Spiritual, moral, social and cultural development is planned across the curriculum", e: "SMSC mapping" },
        { id: "pd-re", t: "RE is taught and a daily act of collective worship is provided", e: "RE scheme; worship plan", ref: { maintained: "School Standards and Framework Act 1998", academy: "Funding agreement" }, types: STATE },
        { id: "pd-careers", t: { all: "Careers guidance meets the Gatsby benchmarks, with provider access encounters for Years 8–13", independent: "Secondary pupils receive impartial, up-to-date careers guidance" },
          e: "Careers plan; provider access policy; encounter records", ref: { all: "Education Act 1997 s42B; careers statutory guidance", independent: "ISS Part 1, para 2(2)(e)" }, phases: ["ks3", "ks4", "p16"] },
        { id: "pd-enrich", t: "Pupils have rich wider opportunities, and take-up by disadvantaged pupils is monitored", e: "Enrichment register; trips log" },
        { id: "pd-pe", t: "Pupils have planned physical activity, including at least two hours of PE a week", e: "Timetables; PE plan", ref: { all: "DfE PE expectation", maintained: "DfE PE expectation; PE and sport premium (primary)", academy: "DfE PE expectation; PE and sport premium (primary)" }, phases: SCHOOL_AGE },
        { id: "pd-mh", t: "Pupils' mental health and wellbeing are supported, with a senior mental health lead", e: "Wellbeing strategy; referrals; lead role" },
        { id: "pd-medical", t: "Pupils with medical conditions have individual healthcare plans that are followed", e: "IHPs; medicines records", ref: "Supporting pupils with medical conditions at school" },
        { id: "pd-food", t: "School food meets the school food standards", e: "Menus; caterer compliance", ref: "School Food Standards", types: STATE },
        { id: "pd-voice", t: "Pupils' views shape school life and pupils take on responsibilities", e: "School council minutes; pupil roles" },
        { id: "pd-pfa", t: "Preparation for adulthood plans have clear goals for independence, community and employment", e: "PfA plans; EHCP outcomes", special: true },
        { id: "pd-social", t: "Pupils build socialisation skills step by step so they can be part of a community", e: "Socialisation plans; peer contact records", special: true },
      ],
    },
    {
      id: "ey", icon: "horse-toy", name: "Early years", phases: ["eyfs"],
      sub: "Nursery and Reception provision",
      fallback: [
        "Audit the environment and interactions against the EYFS communication and language area.",
        "Check staff:child ratios and qualifications for every session, including lunchtimes.",
        "Hold a moderation session on EYFS profile judgements with a partner school.",
        "Refresh key person arrangements and share a short guide with parents.",
      ],
      items: [
        { id: "ey-framework", t: "The EYFS learning and development requirements are met across all seven areas", e: "EYFS curriculum; observations", ref: "EYFS statutory framework, Section 1" },
        { id: "ey-key", t: "Every child has a key person and settling-in is planned", e: "Key person allocation; settling-in records", ref: "EYFS statutory framework, Section 3" },
        { id: "ey-cl", t: "Communication and language are prioritised through high-quality interactions, stories and songs", e: "Observations; story and rhyme plan" },
        { id: "ey-ratio", t: "Ratios and qualifications meet EYFS requirements at all times", e: "Rotas; qualifications register", ref: "EYFS statutory framework, Section 3" },
        { id: "ey-assess", t: "The progress check at two (where relevant) and the EYFS profile are completed accurately", e: "Checks; profile moderation", ref: "EYFS statutory framework, Section 2" },
        { id: "ey-rba", t: "The reception baseline assessment is completed", e: "RBA completion record", ref: "Assessment framework: reception baseline", types: STATE },
        { id: "ey-parents", t: "Parents are kept informed and helped to support learning at home", e: "Parent communications; workshops" },
        { id: "ey-y1", t: "Transition into Year 1 is planned so children keep building on what they know", e: "Transition plan; Year 1 curriculum" },
      ],
    },
    {
      id: "p16", icon: "school", name: "Post-16 provision", phases: ["p16"],
      sub: "Sixth form or post-16 programmes",
      fallback: [
        "Review each student's study programme against 16–19 requirements and their career goals.",
        "Track retention and progression by course and act on any course with high drop-out.",
        "Arrange meaningful work experience or industry placements for every student.",
        "Audit the post-16 personal development offer (RSE, safety, finance, citizenship).",
      ],
      items: [
        { id: "p16-prog", t: { all: "Study programmes are coherent, stretching and meet 16–19 funding requirements", independent: "Post-16 programmes of activities suit students' needs" },
          e: "Study programme plans", ref: { all: "16 to 19 study programmes guidance", independent: "ISS Part 1, para 2(2)(g)" } },
        { id: "p16-em", t: "Students without grade 4 in English or maths continue to study them", e: "Enrolment data", ref: "16 to 19 funding: maths and English condition", types: STATE },
        { id: "p16-retain", t: "Retention, completion and progression are tracked and acted on", e: "Retention data; destinations" },
        { id: "p16-work", t: "Students have meaningful work experience or industry placements", e: "Placement records" },
        { id: "p16-careers", t: "Students get impartial advice on university, apprenticeships and employment", e: "Careers records; destinations" },
        { id: "p16-attend", t: "Sixth form attendance and punctuality are monitored and acted on", e: "Attendance data" },
        { id: "p16-pd", t: "Personal development continues post-16, including RSE, safety and financial capability", e: "Tutorial programme" },
        { id: "p16-send", t: "Students with EHC plans follow clear preparation for adulthood pathways", e: "PfA pathways; EHCP reviews", special: true },
      ],
    },
    {
      id: "lg", icon: "compass", name: "Leadership and governance",
      sub: "Leaders, governors, trustees or proprietors",
      fallback: [
        "Rewrite the self-evaluation so every judgement is backed by evidence, then link it to a one-page improvement plan.",
        "Set up a compliance calendar with an owner and review date for every statutory duty.",
        "Hold a governance skills audit and recruit for the gaps.",
        "Run a staff workload and wellbeing survey and publish what you will change.",
      ],
      items: [
        { id: "lg-vision", t: "Leaders have an accurate self-evaluation and a focused improvement plan", e: "SEF; improvement plan with owners and dates" },
        { id: "lg-capacity", t: "Leadership is stable, with enough educational expertise and capacity to improve", e: "Structure chart; leader qualifications" },
        { id: "lg-qa", t: "Quality assurance is robust and leads to quick action", e: "QA calendar; monitoring reports; follow-up" },
        { id: "lg-gov", t: { maintained: "The governing board challenges and supports leaders effectively", academy: "The trust board and local governing bodies hold leaders to account through a clear scheme of delegation", independent: "Governance holds leaders to account, with checks and balances separate from day-to-day leadership" },
          e: "Minutes showing challenge; terms of reference", ref: { maintained: "DfE governance guide", academy: "Academy trust governance guide; Academy trust handbook", independent: "ISS Part 8, para 34" } },
        { id: "lg-separate", t: "The headteacher role is separate from the proprietor, or is independently scrutinised", e: "Role descriptions; external review", types: IND },
        { id: "lg-compliance", t: { all: "Compliance with statutory duties is checked on a set schedule", independent: "There is a mechanism for checking the independent school standards are met consistently" }, e: "Compliance audit; calendar", ref: { independent: "ISS Part 8, para 34(1)(a)–(b)" } },
        { id: "lg-staff", t: "Staff workload and wellbeing are considered, and staff feel supported", e: "Staff survey; workload actions" },
        { id: "lg-ect", t: "Early career teachers receive statutory induction based on the ECF", e: "Induction records; mentor allocation", ref: "Induction for early career teachers (statutory)", types: STATE },
        { id: "lg-finance", t: { maintained: "Finances are well managed and the SFVS is completed", academy: "The trust complies with the Academy trust handbook", independent: "The school is financially sustainable and resources match pupils' needs" }, e: "Budget reports; audit" },
        { id: "lg-psed", t: "The public sector equality duty is met and equality objectives are published", e: "Equality objectives; website", ref: "Equality Act 2010 s149", types: STATE },
        { id: "lg-parents", t: "Parents are well informed and their views are sought and acted on", e: "Parent survey; Ofsted Parent View" },
        { id: "lg-data", t: "One system brings together attendance, progress, SEND and safeguarding information", e: "MIS in use" },
        { id: "lg-policies", t: "Statutory policies are current and reviewed on schedule", e: "Policy register" },
        { id: "lg-wellbeing", t: "Leaders actively promote pupils' wellbeing", e: "Wellbeing strategy", ref: { independent: "ISS Part 8, para 34(1)(c)" } },
      ],
    },
    {
      id: "cm", icon: "clipboard-check", name: "Statutory compliance",
      sub: "Publication, premises, complaints and registration",
      fallback: [
        "Check the website against the publication requirements for your school type and fix gaps this week.",
        "Walk the site with the premises regulations in hand, including medical accommodation.",
        "Test the complaints procedure against the required stages and timescales.",
        "Confirm your registration details with the DfE match what you now provide.",
      ],
      items: [
        { id: "cm-web", t: "Required information is published on the website and kept current", e: "Website audit",
          ref: { maintained: "School Information (England) Regulations 2008", academy: "What academies must publish online", independent: "ISS Part 6" } },
        { id: "cm-complaints", t: "The complaints procedure meets requirements, including a panel stage, and complaints are logged", e: "Complaints policy and log", ref: { maintained: "Education Act 2002 s29", academy: "ISS Part 7", independent: "ISS Part 7" } },
        { id: "cm-premises", t: "Premises are suitable, including accommodation for medical examination and treatment", e: "Premises check", ref: { maintained: "School Premises (England) Regulations 2012", academy: "ISS Part 5, para 24", independent: "ISS Part 5, para 24" } },
        { id: "cm-hs", t: "Health and safety, fire risk assessment and first aid arrangements are current", e: "Fire risk assessment; H&S audit; first aid rota", ref: { independent: "ISS Part 3, paras 11–14" } },
        { id: "cm-supervision", t: "Pupils are properly supervised by sufficient staff", e: "Supervision rotas", ref: "ISS Part 3, para 14", types: IND },
        { id: "cm-registration", t: "Registration details (age range, capacity, SEN types, premises) match current provision", e: "DfE registration; Get Information about Schools", ref: "Education and Skills Act 2008 s162", types: IND },
        { id: "cm-data", t: "Data protection duties are met, with a named data protection officer", e: "Privacy notices; DPO; breach log", ref: "UK GDPR; Data Protection Act 2018" },
        { id: "cm-census", t: "The school census and other statutory returns are submitted accurately and on time", e: "Submission records", types: STATE },
        { id: "cm-contact", t: "Published contact details, including email address, are accurate", e: "Website check" },
      ],
    },
  ];

  const GRADES = [
    { id: "exceptional", label: "Exceptional", color: "var(--g-exc)" },
    { id: "strong", label: "Strong standard", color: "var(--g-strong)" },
    { id: "expected", label: "Expected standard", color: "var(--g-exp)" },
    { id: "attention", label: "Needs attention", color: "var(--g-att)" },
    { id: "urgent", label: "Urgent improvement", color: "var(--g-urg)" },
  ];

  function pick(v, type) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    return v[type] || v.all || "";
  }

  function applies(item, area, ctx) {
    if (area.phases && !area.phases.some(p => ctx.phases.includes(p))) return false;
    if (item.types && !item.types.includes(ctx.type)) return false;
    if (item.phases && !item.phases.some(p => ctx.phases.includes(p))) return false;
    if (item.special && !ctx.special) return false;
    if (item.t && typeof item.t === "object" && !pick(item.t, ctx.type)) return false;
    return true;
  }

  /** Returns the areas and items that apply to this school, with text resolved for its type. */
  function resolve(ctx) {
    return AREAS.map(a => ({
      ...a,
      items: a.items.filter(i => applies(i, a, ctx)).map(i => ({
        id: i.id, text: pick(i.t, ctx.type), evidence: pick(i.e, ctx.type), ref: pick(i.ref, ctx.type), special: !!i.special,
      })),
    })).filter(a => a.items.length);
  }

  const api = { SCHOOL_TYPES, PHASES, AREAS, GRADES, resolve, pick };
  root.HWWD = Object.assign(root.HWWD || {}, { criteria: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
