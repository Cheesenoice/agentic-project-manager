# AI Task Management Agent (June 2026 Stack)

Hệ thống quản lý dự án và phân rã task thông minh sử dụng **LangGraph + Gemini AI + FastAPI + React 19 + Tailwind CSS**.

---

## 🚀 Các Tính Năng Nổi Bật

1. **AI Coordinator (LangGraph)**:
   - **Tự động Phân bổ Công việc**: AI phân tích kỹ năng (skills) và khối lượng công việc hiện tại của các developer để tự động gán task phù hợp nhất.
   - **Tự động Chuyển đổi Trễ hạn (Cascading Timeline Delay)**: Khi báo cáo trễ hạn của một task, hệ thống tự động dịch chuyển thời gian (start/due dates) của tất cả các task phụ thuộc phía sau trên biểu đồ Gantt.
   - **Tự động Rollup trạng thái**: Khi tất cả các subtask (task con) hoàn thành, task cha sẽ tự động chuyển sang trạng thái `done`.

2. **Quy trình Báo cáo Tiến độ (Status Transition UI/UX & AI Reports)**:
   - Khi chuyển trạng thái task sang `done`, hệ thống yêu cầu lập báo cáo tiến độ (Progress Report).
   - AI Coordinator phân tích báo cáo và đề xuất các bước hành động tiếp theo (ví dụ: tạo thêm task hỗ trợ, kiểm thử mở rộng...).

3. **Hoàn tác Thay đổi (Undo Changes)**:
   - Cho phép hoàn tác hành động cập nhật trạng thái hoặc chỉnh sửa task gần nhất chỉ với một click bấm.

4. **Tích hợp Bot Telegram**:
   - Tự động thông báo qua Telegram khi có task hoàn thành (kèm báo cáo tiến độ của developer).
   - Tự động cảnh báo khi các task con bị đẩy lùi lịch do trễ hạn của task phụ thuộc.
   - Chạy ngầm kiểm tra định kỳ (15 giây/lần) và cảnh báo các task quá hạn (overdue) hoặc sắp đến hạn (trong vòng 24 giờ).

5. **Giao diện Dashboard Đa năng (React 19)**:
   - **Kanban Board**: Quản lý kéo thả trạng thái trực quan.
   - **Tree View**: Xem cây phân rã cấp độ của task (`Epic -> Feature -> Task -> Subtask`).
   - **Gantt Chart (Timeline)**: Biểu đồ tiến độ trực quan hiển thị mối quan hệ phụ thuộc.
   - **Calendar View**: Quản lý lịch trình theo tuần/tháng.
   - **Phân quyền vai trò (Role switcher)**: Thay đổi giữa PM (quyền tối cao), Developer (chỉ cập nhật trạng thái/giờ làm việc thực tế), và QA (chỉ kiểm thử).

---

## 🛠️ Hướng dẫn Thiết lập Dự án

### 1. Yêu cầu Hệ thống
- **Python**: 3.10+
- **Node.js**: 18+
- **Poetry** (Quản lý dependency cho Python)

---

### 2. Cấu hình Biến môi trường (Environment Variables)

Tạo hoặc chỉnh sửa file `backend/.env` (hoặc `backend/app/.env` tùy môi trường chạy):

```env
GEMINI_API_KEY=AQ.Ab8RN6KngHFX... # Gemini API Key của bạn
GEMINI_MODEL=gemini-3.1-flash-lite # Model sử dụng

# Cấu hình Telegram Bot (Để nhận thông báo tự động)
TELEGRAM_BOT_TOKEN=6891659551:AAGzcbh51K7WB11otGOLEy79xIQFt1VMIdc
TELEGRAM_CHAT_ID=1139961889
```

---

### 3. Cài đặt và Chạy Backend

1. Di chuyển vào thư mục `backend`:
   ```bash
   cd backend
   ```
2. Cài đặt các thư viện phụ thuộc bằng Poetry:
   ```bash
   poetry install
   ```
3. Chạy server API (FastAPI sử dụng Uvicorn):
   ```bash
   poetry run uvicorn app.main:app --port 8001 --host 127.0.0.1
   ```
   *Lưu ý: Hệ thống sẽ tự động khởi tạo cơ sở dữ liệu SQLite `tasks.db` và seed dữ liệu mẫu tiếng Anh nếu cơ sở dữ liệu trống.*

- **Swagger Docs**: http://127.0.0.1:8001/docs
- **Health check**: http://127.0.0.1:8001/health

---

### 4. Cài đặt và Chạy Frontend

1. Di chuyển vào thư mục `frontend`:
   ```bash
   cd frontend
   ```
2. Cài đặt các gói npm:
   ```bash
   npm install
   ```
3. Khởi chạy React Dev Server (Vite):
   ```bash
   npm run dev
   ```
   *Mặc định Vite sẽ chạy trên cổng `5173` hoặc `5174` (nếu cổng `5173` bị chiếm).*

4. Truy cập giao diện trên trình duyệt: http://localhost:5173 hoặc http://localhost:5174.

---

## 🧪 Kịch bản Kiểm thử Dự án

Để kiểm tra toàn bộ tính năng, bạn có thể thực hiện kiểm thử tự động hoặc kiểm thử thủ công:

### A. Kiểm thử Tự động qua API

Chúng tôi đã viết sẵn các kịch bản kiểm thử tích hợp trong thư mục `scratch`. Bạn có thể chạy trực tiếp:

- **Kiểm thử Rollup, Cascade Delay và AI Allocation**:
  ```bash
  cd backend
  poetry run python C:\Users\huynh\.gemini\antigravity\brain\825923e3-aa96-4227-89b5-b2fdad8cded3\scratch\test_all_scenarios.py
  ```
- **Kiểm thử Quy trình Báo cáo và Undo**:
  ```bash
  cd backend
  poetry run python C:\Users\huynh\.gemini\antigravity\brain\825923e3-aa96-4227-89b5-b2fdad8cded3\scratch\test_reports_undo.py
  ```

---

### B. Kiểm thử Thủ công trên Giao diện (UI)

1. **Phân quyền và Kiểm tra Vai trò**:
   - Đổi dropdown góc trên cùng bên phải từ `pm_alice` sang `dev_bob (DEVELOPER)`.
   - Ấn nút **"Add Task"** -> Hệ thống hiển thị cảnh báo từ chối quyền.
   - Thử chỉnh sửa tiêu đề task bất kỳ -> Các trường dữ liệu quy hoạch dự án bị khóa (disabled), chỉ cho phép sửa trạng thái (status) và số giờ làm thực tế (actual hours).

2. **Tự động Phân bổ bằng AI**:
   - Đổi lại vai trò về `pm_alice`.
   - Trong khung chat AI ở bên phải, bấm nút nhanh `✨ Auto Allocate` và gửi đi.
   - AI sẽ tự động phân tích và gán dev phù hợp. Bấm **"Sync"** ở header và bấm vào task để kiểm chứng người được phân công (`dev_bob` cho frontend, `dev_john` cho database).

3. **Luồng Báo cáo Chuyển Trạng thái (Status Transition Report)**:
   - Sửa trạng thái một task bất kỳ từ `todo` sang `done` và bấm lưu.
   - Modal nhập báo cáo tiến độ hiện ra. Điền báo cáo và bấm gửi.
   - Giao diện xuất hiện banner khuyến nghị hành động tiếp theo của AI Coordinator, đồng thời tin nhắn thông báo được bot bắn thẳng về Telegram của bạn.

4. **Biểu đồ Gantt & Timeline Delay Cascade**:
   - Bấm sang tab **GANTT** để xem biểu đồ Gantt hiện tại.
   - Sửa đổi Task ID `3` (DB Design), kéo lùi ngày hạn (due date) thêm 3 ngày.
   - Quay lại tab **GANTT**, bạn sẽ thấy task phụ thuộc của nó (Task ID `5` - Frontend Login) đã tự động dịch chuyển tiến độ về sau 3 ngày để giải quyết xung đột lịch trình.
