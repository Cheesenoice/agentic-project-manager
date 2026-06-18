# 📝 Kịch Bản Thuyết Trình & Hướng Dẫn Demo (Walkthrough)

Tài liệu này cung cấp mô tả tổng quan dự án, cấu trúc kỹ thuật và hướng dẫn chi tiết từng bước (kèm mốc thời gian thực tế) để chạy thử và thuyết trình các tính năng thông minh của hệ thống trước giáo viên.

---

## I. Tổng Quan Dự Án & Công Nghệ (Project Overview)

### 1. Mô tả dự án
Hệ thống là một **Dashboard Quản lý Dự án Thông minh (AI-Powered Project Management Board)**. Điểm cốt lõi là sự tham gia của **AI Coordinator** (điều phối viên AI) tự động hóa các tác vụ quản trị dự án thông thường, bao gồm:
* Tự phân chia công việc dựa trên năng lực và tải trọng của nhân viên.
* Tự động phát hiện và cảnh báo trễ hạn (Overdue / Due Soon) gửi qua Telegram.
* Tự động điều chỉnh kế hoạch dây chuyền (Timeline Cascade) khi có công việc bị trì hoãn.
* Định tuyến công việc thông minh (Auto-Routing) khi một giai đoạn hoàn thành (ví dụ: gán việc kiểm thử cho QA khi lập trình xong).
* Cơ chế ghi nhận lịch sử trạng thái để hoàn tác lỗi (`Undo`).

### 2. Công nghệ sử dụng (Tech Stack)
* **Backend:** Python, FastAPI, SQLAlchemy (với SQLite), LangGraph (định tuyến trạng thái AI), LangChain (kết nối Gemini API), APScheduler (chạy tác vụ ngầm kiểm tra deadline).
* **Frontend:** React 19, Vite, TypeScript, Lucide Icons.
* **Thông báo:** Telegram Bot API (gửi tin nhắn thông báo tiến độ, cảnh báo deadline real-time).

---

## II. Cấu Trúc Phân Cấp Dự Án (Project Hierarchy)
Hệ thống quản lý dữ liệu theo mô hình phân cấp **4 tầng**:
1. **Epic (Sử thi):** Khối lượng công việc lớn (Ví dụ: *Database Setup*, *Frontend Core*).
2. **Feature (Tính năng):** Các nhóm tính năng trong Epic (Ví dụ: *DB Design*, *UI Components*).
3. **Task (Nhiệm vụ):** Các tác vụ thực tế giao cho thành viên (Ví dụ: *Write SQLAlchemy Models*, *Integrate API*).
4. **Subtask (Tác vụ con):** Nhiệm vụ nhỏ nhất để hoàn thành một Task (Ví dụ: *Define User model*, *Configure migrations*).

---

## III. Kịch Bản Demo Từng Bước (Step-by-Step Demo Script)

### Màn 1: Giới thiệu giao diện & Role Switcher
* **Mục tiêu:** Cho giáo viên thấy giao diện hiện đại, đa góc nhìn và khả năng phân quyền vai trò.
* **Các bước thực hiện:**
  1. Mở trình duyệt tại địa chỉ `http://localhost:5173`.
  2. Giới thiệu thanh **Header** có nút chuyển đổi User nhanh:
     * **Alice:** Vai trò `PM` (Quản trị viên dự án).
     * **Bob:** Vai trò `Developer` (Lập trình viên).
     * **John:** Vai trò `Developer` (Lập trình viên).
     * **Charlie:** Vai trò `QA` (Kiểm thử viên).
  3. Trình diễn 5 Tab xem dự án:
     * **KANBAN:** Quản lý kéo thả công việc thông thường.
     * **TREE:** Biểu đồ cây hiển thị cấu trúc phân cấp từ Epic xuống Subtask.
     * **GANTT:** Sơ đồ ngang thể hiện thời gian bắt đầu, hạn chót và mũi tên liên kết phụ thuộc giữa các task.
     * **CALENDAR:** Lịch làm việc trực quan theo ngày/tháng.
     * **HEALTH:** Điểm số sức khỏe dự án tính toán tự động dựa trên số công việc trễ hạn, bị khóa (blocked), kèm báo cáo phân tích bằng tiếng Anh từ AI Coordinator.

---

### Màn 2: Kiểm soát Phân Quyền (Permissions Control)
* **Mục tiêu:** Chứng minh hệ thống kiểm soát quyền hạn chặt chẽ giữa Developer và PM/QA.
* **Các bước thực hiện:**
  1. Chuyển User trên Header sang `dev_bob` (Developer).
  2. Bấm vào nút **Add Task** -> Hệ thống hiển thị cảnh báo không có quyền tạo tác vụ.
  3. Click đúp chuột vào task *"DB Design & SQLAlchemy Models"* để mở modal chi tiết:
     * Thay đổi trạng thái sang `done` -> Hệ thống sẽ hiển thị thông báo lỗi hoặc vô hiệu hóa lựa chọn (Developer không được tự ý đóng task Done, chỉ có PM hoặc QA mới có quyền phê duyệt kết quả).
  4. Đóng modal và chuyển User lại thành `pm_alice`.

---

### Màn 3: AI Phân chia công việc tự động (✨ Auto Allocate)
* **Mục tiêu:** Trình diễn khả năng phân phối công việc thông minh bằng AI chat.
* **Các bước thực hiện:**
  1. Chọn User `pm_alice`.
  2. Tại bảng chat AI ở góc phải màn hình, nhấp vào nút gợi ý nhanh **"✨ Auto Allocate"** (hoặc nhập chat: `auto allocate tasks`).
  3. AI sẽ phân tích:
     * Danh sách các task chưa có ai đảm nhận.
     * Kỹ năng (skills) của Bob (React, CSS) và John (SQL, Python).
     * Tải trọng công việc hiện tại của họ để tránh quá tải.
  4. **Kết quả:** AI tự động cập nhật người đảm nhận trên bảng Kanban và gửi thông báo lý do phân bổ thành công lên khung chat.

---

### Màn 4: Thực nghiệm Thông Báo Hạn Chót (Deadline Alerts) ⏰
* **Mục tiêu:** Chứng minh tác vụ ngầm chạy chu kỳ 15 giây tự động gửi cảnh báo qua Telegram khi có công việc sắp hết hạn hoặc đã trễ hạn, đồng thời tag trực tiếp tên người được giao việc (`@username`).
* **Các bước thực hiện:**
  1. Chọn User `pm_alice`.
  2. Chọn một task bất kỳ đang ở trạng thái `in_progress` (ví dụ: *"Project Planning"* hoặc *"Setup Environment"*) và có gán cho một Developer (ví dụ: `@dev_bob`).
  3. Click đúp để mở modal chỉnh sửa thông tin.
  4. Quan sát giờ hiện tại của máy tính (Ví dụ thực tế lúc này là **10:31 sáng** ngày **18/06/2026**).
  5. **Mô phỏng trường hợp Trễ hạn (OVERDUE):**
     * Tại mục **DUE DATE**, chọn thời gian trong quá khứ gần (Ví dụ chỉnh thành **10:20 sáng** cùng ngày **18/06/2026**).
     * Click **Save** để cập nhật lên cơ sở dữ liệu.
     * Đợi tối đa 15 giây (chu kỳ quét của Scheduler).
     * **Kết quả:** Điện thoại/Màn hình Telegram sẽ báo tin nhắn từ Bot chứa tag tên dev:
       `[DEADLINE ALERT] Task 'Project Planning' is OVERDUE! Assigned to: @dev_bob (Due: 2026-06-18 10:20)`
  6. **Mô phỏng trường hợp Sắp đến hạn (DUE SOON):**
     * Tương tự, chỉnh sửa **DUE DATE** của một task khác thành mốc thời gian trong tương lai gần trong vòng 24 giờ (Ví dụ chỉnh thành **11:30 sáng** ngày **18/06/2026**).
     * Click **Save**.
     * Đợi tối đa 15 giây.
     * **Kết quả:** Bot Telegram sẽ lập tức gửi cảnh báo kèm tag tên:
       `[DEADLINE ALERT] Task 'Setup Environment' is due soon! Assigned to: @dev_john (Due: 2026-06-18 11:30)`

---

### Màn 5: Kéo thả Thẻ Kanban & Gợi Ý AI Báo Cáo Tiến Độ (Kanban Drag & Drop & AI Suggestions)
* **Mục tiêu:** Cho giáo viên thấy tính năng kéo thả trực quan trên bảng Kanban để cập nhật trạng thái tác vụ, đi kèm kiểm soát phân quyền và hỗ trợ nhập báo cáo nhanh bằng AI thông qua gợi ý tối giản (chỉ vài từ).
* **Các bước thực hiện:**
  1. Đăng nhập với tư cách PM (`pm_alice`) hoặc Developer (`dev_john`).
  2. Tại bảng **KANBAN**, trên mỗi task card có một thanh kéo viền đen đậm với nhãn **✥ MOVE TASK**. Di chuột vào thanh này, con trỏ chuột chuyển sang dạng di chuyển (`move`).
  3. Nhấp giữ thanh **✥ MOVE TASK** này để kéo (Drag) thẻ task card di chuyển sang cột trạng thái khác. Nếu click vào phần thân thẻ bên dưới, hệ thống vẫn mở modal chỉnh sửa chi tiết task bình thường.
  4. Khi thả (Drop) thẻ vào cột mới:
     * Hệ thống sẽ tự động bật mở modal **Confirm Status Transition** yêu cầu điền báo cáo tiến độ (*Progress Report*).
     * 3 nút bấm gợi ý (Pills) xuất hiện ngay dưới ô nhập liệu (Ví dụ: *"Started working on task."*, *"Began development."*, *"In progress."*).
     * Bấm vào nút gợi ý mong muốn -> Nội dung tự điền lập tức vào ô text.
     * Click **Submit & Update** để hoàn tất cập nhật.
  5. **Demo phân quyền kéo thả:**
     * Chuyển user sang `dev_bob`.
     * Kéo một task card bất kỳ thả vào cột **DONE** -> Hệ thống ngay lập tức hiện cảnh báo chặn quyền: *"Developers are not allowed to change task status to Done. Only PM or QA can complete tasks."* và khôi phục vị trí thẻ.
     * Kéo một task card từ cột **DONE** sang bất cứ cột nào khác -> Hệ thống báo chặn quyền: *"Developers are not allowed to change status of completed tasks."* và khôi phục vị trí thẻ.
     * Click mở modal chi tiết của một task đang có trạng thái **DONE** -> Lựa chọn chọn trạng thái (STATUS) bị vô hiệu hóa (disabled) không cho phép thay đổi.



---

### Màn 6: AI Định Tuyến Công Việc QA (QA Auto-Routing)
* **Mục tiêu:** Chứng minh AI có khả năng tự nhận diện giai đoạn dự án, chuyển giao công việc và giao cho kiểm thử viên QA.
* **Các bước thực hiện:**
  1. Đăng nhập với User `pm_alice`.
  2. Chọn task có chứa subtask liên quan tới Coding (ví dụ: *"Setup Environment"*).
  3. Đánh dấu tất cả các subtask của task này thành `done`.
  4. Nhờ cơ chế **Subtask Rollup**, parent task sẽ tự động chuyển trạng thái.
  5. Hệ thống AI Routing phát hiện giai đoạn Code hoàn tất:
     * Hệ thống tự động chuyển task đó sang trạng thái `qa_review`.
     * Tự động gán người thực hiện sang cho `qa_charlie` (QA kiểm thử).
     * AI tự động viết bình luận giải thích lý do gán việc trên task đó.
  6. **Kết quả:** Giao diện cập nhật người thực hiện là Charlie, Telegram gửi tin tag `@qa_charlie` vào thực hiện công việc.

---

### Màn 7: Lùi Lịch Kế Hoạch (Gantt Cascade) & Hoàn Tác (Undo)
* **Mục tiêu:** Trình diễn khả năng tính toán lùi lịch dây chuyền và nút Undo cứu cánh khi thao tác sai.
* **Các bước thực hiện:**
  1. Chuyển sang Tab **GANTT** để quan sát sơ đồ dòng thời gian.
  2. Tại khung chat AI, click Quick Prompt **"⚠️ Report Delay"** hoặc gõ chat: `task 18 is delayed by 3 days`.
  3. AI sẽ tự động dời lịch của task 18 thêm 3 ngày, đồng thời tất cả các task phụ thuộc ở phía sau cũng tự động bị đẩy lùi lịch tương ứng để tránh chồng chéo lịch làm việc.
  4. Xem cập nhật hiển thị trực quan trên sơ đồ Gantt và thông báo đẩy lùi lịch trên Telegram.
  5. **Thực hiện Hoàn tác (Undo):**
     * Để hủy bỏ hành động lùi lịch vừa rồi, bấm vào nút **"Undo Last Change"** (màu cam, cạnh nút làm mới trên Header).
     * Toàn bộ ngày giờ của các tác vụ lập tức hồi phục về trạng thái ban đầu giống như chưa hề có thay đổi.

---

### Màn 8: Khởi Tạo Dự Án Mới Tại Chỗ & Quy Trình Đổi Vai Trò Phối Hợp (PM ➔ Dev ➔ QA ➔ PM)
* **Mục tiêu:** Chứng minh sức mạnh khởi tạo tức thì của hệ thống. AI tự động rã nhánh dự án từ ý tưởng ban đầu, phân bổ công việc và phối hợp đổi vai trò liên tục ngay trước mặt giáo viên.
* **Các bước thực hiện:**
  1. **Bước 1: Khởi tạo dự án (PM Alice):**
     * Chọn User `pm_alice` trên Header.
     * Ở khung **Create Project** bên trái, nhập:
       * **Project Name:** `E-Commerce Mobile App`
       * **Project Description:** `Build a cross-platform mobile app for shopping, listing products, adding to cart, and processing payments.`
     * Click **"Decompose with AI Agent"**.
     * Giải thích với giáo viên: *Hệ thống đang gọi AI Decomposition Agent ngầm để phân tách đặc tả nghiệp vụ tự động thành 4 tầng Epic -> Feature -> Task -> Subtask.*
     * Chờ 5-10 giây rồi click nút **Làm mới (Sync)** trên Header.
     * **Kết quả:** Dự án `E-Commerce Mobile App` được tạo thành công. Click chọn dự án, chuyển sang Tab **TREE** để xem sơ đồ phân rã công việc chi tiết do AI tự động tạo dựng.
  2. **Bước 2: AI Tự giao việc (PM Alice):**
     * Nhấp vào gợi ý **"✨ Auto Allocate"** trong AI Chat để AI tự động phân bổ các công việc lập trình cho `dev_bob` và `dev_john` dựa trên chuyên môn.
  3. **Bước 3: Thực hiện công việc (Developer Bob):**
     * Đổi User sang `dev_bob`.
     * Mở Tab **KANBAN**, kéo task Frontend được giao sang `in_progress`.
     * Khi hiện modal báo cáo, click chọn gợi ý báo cáo nhanh *"Started working on task."* và bấm **Submit**.
     * Khi lập trình xong, Bob kéo tiếp sang `qa_review`. Lúc này AI tự động định tuyến bàn giao việc kiểm thử cho `qa_charlie` kèm tag tên trên Telegram.
  4. **Bước 4: Kiểm thử và Duyệt hoàn thành (QA Charlie):**
     * Đổi User sang `qa_charlie`.
     * Charlie mở tab KANBAN hoặc mở task được gán, kiểm tra kết quả.
     * Kéo task sang `done` (quyền hạn chỉ QA/PM được phép). Chọn nhanh gợi ý báo cáo tiến độ *"Completed task successfully."* rồi click **Submit**.
  5. **Bước 5: Giám sát tổng thể (PM Alice):**
     * Đổi User quay lại `pm_alice`.
     * Vào Tab **HEALTH** để xem điểm sức khỏe dự án đã được AI Coordinator tính toán cập nhật dựa trên tiến trình thực tế.

---

### Màn 9: Xử Lý Tác Vụ Bị Khóa (Blocked Task & Risk Mitigation)
* **Mục tiêu:** Trình diễn cách hệ thống quản trị rủi ro dự án: ghi nhận nguyên nhân nghẽn việc (BLOCKED), bắn tin khẩn cấp qua Telegram, tự động trừ điểm sức khỏe dự án và gợi ý tháo gỡ bằng AI.
* **Các bước thực hiện:**
  1. **Bước 1: Báo cáo công việc bị khóa (Developer Bob):**
     * Đăng nhập với User `dev_bob`.
     * Trên bảng **KANBAN**, kéo một task card được giao (ví dụ: *"Stripe Integration"*) thả vào cột **BLOCKED** (hoặc chọn STATUS là **BLOCKED** trong modal chỉnh sửa).
     * Modal báo cáo hiện ra. Bob click chọn gợi ý nhanh *"Work is blocked."* hoặc tự gõ nguyên nhân: `"Missing Stripe API keys and payment sandbox credentials from client."`
     * Bấm **Submit**.
  2. **Bước 2: Cảnh báo khẩn cấp thời gian thực:**
     * Telegram Bot lập tức gửi tin nhắn khẩn cấp cho toàn nhóm:
       `[STATUS UPDATE] dev_bob updated Stripe Integration to BLOCKED. Reason: Missing Stripe API keys and payment sandbox credentials from client.`
  3. **Bước 3: AI phân tích rủi ro & Đề xuất hành động tháo gỡ (PM Alice):**
     * Đổi User sang `pm_alice`.
     * Phía trên cùng màn hình Dashboard của Alice lập tức xuất hiện Banner màu xanh lục **💡 AI RECOMMENDED ACTION** (đọc hiểu từ lý do báo cáo của Bob):
       * AI nhận diện tác vụ bị khóa do thiếu thông tin từ đối tác.
       * AI tự động đề xuất PM hành động tiếp theo: Tạo một task mới tên là *"Request API Credentials from Client"* thuộc pha Planning/Design.
  4. **Bước 4: Đánh giá tác động đến sức khỏe dự án:**
     * PM Alice chuyển sang Tab **HEALTH**.
     * Trình bày điểm số **Health Score** bị sụt giảm, số lượng **Blocked Tasks** tăng lên `1`.
     * Phần **Bottlenecks** hiển thị rõ Bob đang gặp nghẽn tại task này và phần đánh giá Executive AI Assessment phân tích mức độ ảnh hưởng của việc nghẽn tiến trình này lên thời hạn chung của toàn dự án.


