# PRD Backend Ví Vi Vu

Phiên bản: 1.0  
Ngày lập: 2026-05-30  
Đối tượng sử dụng: Backend/Harness Engineer  
Stack mục tiêu: Expo mobile app, Express.js API, PostgreSQL hosted by Supabase, Google Gemini server-managed keys

## 1. Bối cảnh

Ví Vi Vu là ứng dụng mobile quản lý tài chính cá nhân cho người dùng Việt Nam. Sản phẩm kế thừa web app hiện tại tại repo `phuc220204/ExpenseTrackerApp`, nơi phần lớn logic dữ liệu đang nằm ở client và Firebase/Firestore. Backend mới cần chuyển các năng lực cốt lõi sang Express + PostgreSQL/Supabase để có schema rõ ràng, API ổn định cho Expo, phân quyền chắc hơn, dễ kiểm thử, và dễ mở rộng các tính năng AI, import/export, thống kê, thông báo.

Nguồn tham khảo:

- SRS `VI_VI_VU.docx`: mô tả 12 nhóm chức năng chính của app mobile.
- Repo web tham chiếu: https://github.com/phuc220204/ExpenseTrackerApp.git
- Backend hiện tại: Express skeleton, đã có `pg`, `dotenv`, `db.js`, endpoint `/health/db`.

## 2. Mục tiêu sản phẩm backend

Backend phải cung cấp một API bảo mật, nhất quán và dễ tích hợp cho app Expo, bao phủ:

- Xác thực Google OAuth từ mobile, quản lý phiên 3 giờ, hồ sơ người dùng.
- CRUD giao dịch thu/chi với ledger, category/subcategory, ngân hàng/ví, note, ngày giao dịch.
- Truy vấn danh sách, lịch, tổng thu/chi/số dư, thống kê theo thời gian và danh mục.
- Quản lý ngân sách, mục tiêu tiết kiệm, nợ, thử thách, danh sách mua sắm.
- Import/export CSV/XLSX/PDF.
- Tích hợp AI Gemini bằng API key lưu trong backend environment, tách riêng key chatbot và receipt scan.
- Receipt scan bằng Gemini Vision.
- Reminder và push notification cho ngân sách, nợ, daily logging, goal completion.
- Sync mobile ổn định, có nền tảng cho offline queue và delta sync.

## 3. Không thuộc phạm vi PRD này

- UI mobile Expo chi tiết.
- Hệ thống thanh toán thật hoặc liên kết tài khoản ngân hàng thật.
- Tự động scrape sao kê ngân hàng.
- Lưu Gemini API key ở server.
- Tư vấn tài chính chuyên nghiệp có tính pháp lý. AI chỉ đưa gợi ý hỗ trợ cá nhân.

## 4. Giả định kỹ thuật

- Expo dùng Google Sign-In native và gửi `idToken` lên backend.
- Backend verify Google `idToken`, upsert user, phát hành backend access token.
- PostgreSQL trên Supabase là nguồn dữ liệu chính.
- Backend dùng direct Postgres connection qua `pg`. Quyền sở hữu dữ liệu được enforce ở API layer bằng `user_id`.
- Có thể bổ sung Supabase RLS ở giai đoạn hardening nếu quyết định dùng Supabase Auth/JWT claims.
- Timezone nghiệp vụ mặc định là `Asia/Ho_Chi_Minh`.
- Tiền tệ mặc định là VND, lưu amount bằng integer nhỏ nhất theo VND, không dùng float.

## 5. Kiến trúc mục tiêu

### 5.1 Thành phần

- Mobile app Expo: UI, SecureStore, camera, biometric, local offline queue.
- Express API: auth, validation, business logic, ownership checks, AI orchestration, export files.
- PostgreSQL/Supabase: transactional storage, indexes, audit fields.
- Background scheduler: reminder daily jobs, overdue debt checks, budget threshold checks.
- Push provider: Expo Push Notifications.
- Gemini API: chat/function calling/receipt extraction qua backend-managed API keys.

### 5.2 Cấu trúc backend đề xuất

```text
src/
  app.js
  server.js
  config/
    env.js
    db.js
  middlewares/
    auth.js
    errorHandler.js
    validate.js
    rateLimit.js
  modules/
    auth/
    users/
    ledgers/
    categories/
    transactions/
    analytics/
    budgets/
    goals/
    debts/
    challenges/
    shopping/
    ai/
    imports/
    exports/
    notifications/
    sync/
  db/
    migrations/
    seeds/
  tests/
```

### 5.3 Quy chuẩn API

- Base path: `/api/v1`.
- JSON response chuẩn:

```json
{
  "data": {},
  "meta": {},
  "error": null
}
```

- Error response chuẩn:

```json
{
  "data": null,
  "meta": { "requestId": "..." },
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Số tiền phải lớn hơn 0",
    "details": []
  }
}
```

- Tất cả endpoint private phải filter theo `req.user.id`.
- Dữ liệu ghi/xóa nên có `created_at`, `updated_at`, `deleted_at` để hỗ trợ sync và undo.

## 6. Data model cấp cao

Tên bảng có thể điều chỉnh theo convention repo, nhưng cần giữ đủ quan hệ và constraints.

### 6.1 Auth và user

```sql
users (
  id uuid primary key,
  google_sub text unique not null,
  email text unique not null,
  display_name text,
  avatar_url text,
  locale text default 'vi-VN',
  timezone text default 'Asia/Ho_Chi_Minh',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

sessions (
  id uuid primary key,
  user_id uuid not null references users(id),
  refresh_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
)

user_settings (
  user_id uuid primary key references users(id),
  theme text default 'system',
  daily_reminder_enabled boolean default false,
  budget_warning_enabled boolean default true,
  debt_reminder_enabled boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

### 6.2 Ledger, category, bank

```sql
ledgers (
  id uuid primary key,
  user_id uuid not null references users(id),
  name text not null,
  is_default boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)

categories (
  id uuid primary key,
  user_id uuid references users(id),
  type text not null check (type in ('income', 'expense')),
  name text not null,
  parent_id uuid references categories(id),
  icon text,
  color text,
  is_system boolean default false,
  sort_order int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)

payment_accounts (
  id uuid primary key,
  user_id uuid references users(id),
  name text not null,
  short_name text,
  type text check (type in ('cash', 'traditional_bank', 'digital_bank', 'e_wallet')),
  color text,
  is_system boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)
```

System seed phải gồm danh mục 2 cấp từ SRS:

- Expense: Ăn uống, Di chuyển, Mua sắm, Hóa đơn, Giải trí, Y tế, Giáo dục, Tiết kiệm/Đầu tư, Khác.
- Income: Thu nhập, Khác.
- Subcategory theo phụ lục SRS.
- Bank/e-wallet: Vietcombank, Techcombank, BIDV, Agribank, MBBank, VPBank, ACB, TPBank, Sacombank, Timo, Cake by VPBank, KBank, TNEX, MoMo, ZaloPay, VNPay, ShopeePay.

### 6.3 Transaction và analytics

```sql
transactions (
  id uuid primary key,
  user_id uuid not null references users(id),
  ledger_id uuid not null references ledgers(id),
  type text not null check (type in ('income', 'expense')),
  amount_vnd bigint not null check (amount_vnd > 0),
  category_id uuid references categories(id),
  subcategory_id uuid references categories(id),
  category_name_snapshot text not null,
  subcategory_name_snapshot text,
  transaction_date date not null,
  note text default '',
  payment_method text not null check (payment_method in ('cash', 'transfer')),
  payment_account_id uuid references payment_accounts(id),
  receipt_image_url text,
  source text default 'manual' check (source in ('manual', 'ai', 'receipt_scan', 'import', 'shopping_plan')),
  client_mutation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)
```

Indexes bắt buộc:

- `(user_id, ledger_id, transaction_date desc)`
- `(user_id, ledger_id, type, transaction_date desc)`
- `(user_id, ledger_id, category_id, transaction_date desc)`
- unique partial `(user_id, client_mutation_id)` where `client_mutation_id is not null`

### 6.4 Planning

```sql
budgets (
  id uuid primary key,
  user_id uuid not null references users(id),
  ledger_id uuid not null references ledgers(id),
  category_id uuid references categories(id),
  month date not null,
  limit_amount_vnd bigint not null check (limit_amount_vnd > 0),
  warning_threshold int default 80,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)

goals (
  id uuid primary key,
  user_id uuid not null references users(id),
  ledger_id uuid not null references ledgers(id),
  name text not null,
  target_amount_vnd bigint not null check (target_amount_vnd > 0),
  current_amount_vnd bigint not null default 0,
  deadline date,
  icon text,
  color text,
  status text default 'active' check (status in ('active', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)

debts (
  id uuid primary key,
  user_id uuid not null references users(id),
  ledger_id uuid not null references ledgers(id),
  direction text not null check (direction in ('borrowed', 'lent')),
  counterparty_name text not null,
  amount_vnd bigint not null check (amount_vnd > 0),
  remaining_amount_vnd bigint not null check (remaining_amount_vnd >= 0),
  due_date date,
  note text,
  status text default 'active' check (status in ('active', 'paid', 'overdue', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)

debt_payments (
  id uuid primary key,
  user_id uuid not null references users(id),
  debt_id uuid not null references debts(id),
  amount_vnd bigint not null check (amount_vnd > 0),
  paid_at date not null,
  note text,
  created_at timestamptz not null default now()
)

challenges (
  id uuid primary key,
  user_id uuid not null references users(id),
  ledger_id uuid not null references ledgers(id),
  name text not null,
  target_amount_vnd bigint,
  start_date date not null,
  end_date date not null,
  current_amount_vnd bigint default 0,
  streak_days int default 0,
  status text default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)

challenge_checkins (
  id uuid primary key,
  user_id uuid not null references users(id),
  challenge_id uuid not null references challenges(id),
  checkin_date date not null,
  amount_vnd bigint default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (challenge_id, checkin_date)
)
```

### 6.5 Shopping list

```sql
shopping_plans (
  id uuid primary key,
  user_id uuid not null references users(id),
  ledger_id uuid not null references ledgers(id),
  name text not null,
  budget_amount_vnd bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)

shopping_items (
  id uuid primary key,
  user_id uuid not null references users(id),
  shopping_plan_id uuid not null references shopping_plans(id),
  name text not null,
  quantity numeric default 1,
  estimated_price_vnd bigint not null default 0,
  is_bought boolean default false,
  linked_transaction_id uuid references transactions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)
```

### 6.6 AI, import/export, notification

```sql
ai_conversations (
  id uuid primary key,
  user_id uuid not null references users(id),
  ledger_id uuid references ledgers(id),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)

ai_messages (
  id uuid primary key,
  conversation_id uuid not null references ai_conversations(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text,
  function_name text,
  function_payload jsonb,
  created_at timestamptz not null default now()
)

import_jobs (
  id uuid primary key,
  user_id uuid not null references users(id),
  ledger_id uuid not null references ledgers(id),
  source_type text not null check (source_type in ('csv', 'xlsx', 'paste_text')),
  status text not null check (status in ('preview', 'processing', 'completed', 'failed')),
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

device_tokens (
  id uuid primary key,
  user_id uuid not null references users(id),
  platform text check (platform in ('ios', 'android')),
  expo_push_token text not null unique,
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

notification_events (
  id uuid primary key,
  user_id uuid not null references users(id),
  type text not null,
  title text not null,
  body text not null,
  payload jsonb,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
)
```

## 7. API surface mục tiêu

### 7.1 Auth

| Method | Path | Mục đích |
| --- | --- | --- |
| POST | `/api/v1/auth/google` | Verify Google idToken, upsert user, trả access/refresh token |
| POST | `/api/v1/auth/refresh` | Cấp access token mới |
| POST | `/api/v1/auth/logout` | Revoke refresh token |
| GET | `/api/v1/me` | Lấy profile và settings |
| PATCH | `/api/v1/me` | Cập nhật display name/settings cơ bản |

Acceptance:

- Token hết hạn sau 3 giờ theo SRS.
- User không thể đọc/ghi dữ liệu của user khác.
- Khi login lần đầu, backend tạo default ledger, categories, payment accounts.

### 7.2 Ledgers, categories, payment accounts

| Method | Path | Mục đích |
| --- | --- | --- |
| GET | `/api/v1/ledgers` | Danh sách sổ thu chi |
| POST | `/api/v1/ledgers` | Tạo sổ |
| PATCH | `/api/v1/ledgers/:id` | Đổi tên |
| DELETE | `/api/v1/ledgers/:id` | Soft delete, không cho xóa sổ cuối cùng |
| GET | `/api/v1/categories` | Danh mục theo type và parent |
| POST | `/api/v1/categories` | Tạo category/subcategory custom |
| PATCH | `/api/v1/categories/:id` | Cập nhật icon/color/name |
| DELETE | `/api/v1/categories/:id` | Soft delete category custom |
| GET | `/api/v1/payment-accounts` | Danh sách ngân hàng/ví/tiền mặt |

### 7.3 Transactions

| Method | Path | Mục đích |
| --- | --- | --- |
| GET | `/api/v1/transactions` | List có filter: ledger, date range, type, category, search, pagination |
| POST | `/api/v1/transactions` | Tạo giao dịch |
| GET | `/api/v1/transactions/:id` | Chi tiết giao dịch |
| PATCH | `/api/v1/transactions/:id` | Sửa giao dịch |
| DELETE | `/api/v1/transactions/:id` | Soft delete |
| POST | `/api/v1/transactions/bulk` | Tạo nhiều giao dịch từ import/AI |
| GET | `/api/v1/transactions/calendar` | Summary theo ngày trong tháng |
| GET | `/api/v1/transactions/summary` | Tổng thu, tổng chi, số dư, số lượng |

Validation:

- `amount_vnd` là integer dương.
- `transaction_date` hợp lệ.
- `type` chỉ là `income` hoặc `expense`.
- `payment_method=transfer` nên có `payment_account_id` nếu user chọn ngân hàng/ví.
- Category phải thuộc user hoặc system category, đúng type.

### 7.4 Analytics

| Method | Path | Mục đích |
| --- | --- | --- |
| GET | `/api/v1/analytics/overview` | Cards tổng thu/chi/số dư/số giao dịch |
| GET | `/api/v1/analytics/category-breakdown` | Pie chart theo danh mục |
| GET | `/api/v1/analytics/daily-spending` | Bar chart theo ngày |
| GET | `/api/v1/analytics/monthly-trend` | Thu vs chi theo tháng |
| GET | `/api/v1/analytics/fluctuation` | Biến động chi tiêu |

Acceptance:

- Query chạy tốt với 10.000 giao dịch/user.
- Có index và EXPLAIN cho query chính.
- Kết quả tính bằng SQL aggregation, không fetch toàn bộ về app.

### 7.5 Budgets

| Method | Path | Mục đích |
| --- | --- | --- |
| GET | `/api/v1/budgets?month=YYYY-MM` | List ngân sách kèm spent/progress |
| POST | `/api/v1/budgets` | Tạo ngân sách tháng/category |
| PATCH | `/api/v1/budgets/:id` | Cập nhật limit/threshold |
| DELETE | `/api/v1/budgets/:id` | Soft delete |

Acceptance:

- Cảnh báo 80% và 100% dựa trên expense trong cùng tháng, ledger, category.
- Không tạo trùng budget cùng user, ledger, category, month.

### 7.6 Goals

| Method | Path | Mục đích |
| --- | --- | --- |
| GET | `/api/v1/goals` | List goals |
| POST | `/api/v1/goals` | Tạo goal |
| PATCH | `/api/v1/goals/:id` | Sửa goal |
| POST | `/api/v1/goals/:id/deposits` | Nạp tiền vào goal |
| DELETE | `/api/v1/goals/:id` | Soft delete |

Acceptance:

- Khi `current_amount_vnd >= target_amount_vnd`, status chuyển `completed`.
- Có notification event khi hoàn thành.

### 7.7 Debts

| Method | Path | Mục đích |
| --- | --- | --- |
| GET | `/api/v1/debts` | List debts, filter status |
| POST | `/api/v1/debts` | Tạo khoản vay/cho vay |
| PATCH | `/api/v1/debts/:id` | Sửa khoản nợ |
| POST | `/api/v1/debts/:id/payments` | Ghi nhận trả/thu nợ một phần |
| DELETE | `/api/v1/debts/:id` | Soft delete |

Acceptance:

- Payment cập nhật `remaining_amount_vnd` trong DB transaction.
- Nếu còn lại bằng 0, status `paid`.
- Job hằng ngày đánh dấu `overdue`.

### 7.8 Challenges

| Method | Path | Mục đích |
| --- | --- | --- |
| GET | `/api/v1/challenges` | List challenges |
| POST | `/api/v1/challenges` | Tạo challenge |
| POST | `/api/v1/challenges/:id/checkins` | Check-in theo ngày |
| PATCH | `/api/v1/challenges/:id` | Sửa challenge |
| DELETE | `/api/v1/challenges/:id` | Soft delete |

Acceptance:

- Một challenge chỉ có một check-in mỗi ngày.
- Streak tính theo chuỗi ngày liên tiếp.

### 7.9 Shopping plans

| Method | Path | Mục đích |
| --- | --- | --- |
| GET | `/api/v1/shopping-plans` | List plans |
| POST | `/api/v1/shopping-plans` | Tạo plan |
| GET | `/api/v1/shopping-plans/:id` | Chi tiết kèm items |
| PATCH | `/api/v1/shopping-plans/:id` | Sửa plan |
| DELETE | `/api/v1/shopping-plans/:id` | Soft delete |
| POST | `/api/v1/shopping-plans/:id/items` | Thêm item |
| PATCH | `/api/v1/shopping-items/:id` | Sửa/toggle bought |
| DELETE | `/api/v1/shopping-items/:id` | Soft delete item |
| POST | `/api/v1/shopping-items/:id/convert-to-transaction` | Tạo expense từ item đã mua |

Acceptance:

- Khi convert, tạo transaction source `shopping_plan` và link `linked_transaction_id`.
- Không tạo trùng nếu item đã linked transaction.

### 7.10 AI

| Method | Path | Mục đích |
| --- | --- | --- |
| POST | `/api/v1/ai/chat` | Chat với Gemini, hỗ trợ function calling |
| POST | `/api/v1/ai/transaction-preview` | Parse câu tự nhiên thành giao dịch preview |
| POST | `/api/v1/ai/execute-action` | Thực thi action sau khi user xác nhận |
| POST | `/api/v1/ai/receipt-scan` | Nhận image base64/file, trả structured transaction preview |
| GET | `/api/v1/ai/conversations` | Lịch sử chat |
| GET | `/api/v1/ai/conversations/:id/messages` | Messages |

Quy tắc Gemini API key:

- Backend đọc Gemini key từ environment, không nhận Gemini key từ client.
- Chatbot dùng `GEMINI_CHAT_API_KEY`.
- Receipt scan dùng `GEMINI_RECEIPT_API_KEY`.
- Không commit key thật vào repo, không log key, redact key khỏi error traces.
- Nếu thiếu key tương ứng, trả lỗi `GEMINI_KEY_REQUIRED`.
- Gemini request phải có timeout server-side (`GEMINI_TIMEOUT_MS`) và trả lỗi chuẩn khi timeout.
- Endpoint receipt scan dùng body limit riêng (`AI_RECEIPT_BODY_LIMIT`) và kiểm tra decoded image size (`AI_RECEIPT_IMAGE_MAX_BYTES`).

Nguồn tham chiếu từ repo web `phuc220204/ExpenseTrackerApp`:

- `src/services/gemini.js` định nghĩa system instruction tiếng Việt, inject ngày hiện tại theo `Asia/Ho_Chi_Minh`, quy tắc chuẩn hóa tiền Việt, strategy suy luận category, persona trợ lý tài chính, function declarations cho Gemini, và luồng gọi Gemini lần 2 để format phản hồi sau khi có function result.
- `src/services/geminiFunctionHandlers.js` chứa logic parse ngày tương đối/Vietnamese date/month range, tạo transaction preview thay vì lưu ngay, query giao dịch theo khoảng thời gian, tính thu/chi/số dư, và xử lý delete dựa trên transaction IDs.
- `extractReceiptData` trong `src/services/gemini.js` dùng Gemini Vision với structured JSON gồm `amount`, `date`, `description`, `category`; backend mới phải nâng cấp kết quả này thành transaction preview đã map sang schema PostgreSQL.

Yêu cầu chatbot AI backend:

- `POST /api/v1/ai/chat` nhận `message`, `ledgerId`, `conversationId?`, `saveHistory?`, `currentDate?`, `timeZone?`; API key lấy từ server env `GEMINI_CHAT_API_KEY`.
- Chatbot mặc định lưu lịch sử hội thoại; client có thể gửi `saveHistory=false` nếu muốn tắt cho từng request.
- System prompt phải dùng tiếng Việt tự nhiên, nêu rõ vai trò trợ lý tài chính cá nhân, không đưa lời khuyên tài chính mang tính pháp lý/chuyên nghiệp, và inject ngày hiện tại ở cả `DD/MM/YYYY` và `YYYY-MM-DD`.
- Prompt phải yêu cầu AI phân loại intent tối thiểu: thêm giao dịch, tra cứu/phân tích, hỏi lời khuyên, xóa giao dịch, hoặc chat thường.
- Chuẩn hóa tiền: số `< 1000` hiểu là nghìn VND; `k/nghìn/ngàn` là nghìn; `m/tr/triệu/củ` là triệu; output lưu bằng integer `amountVnd`.
- Chuẩn hóa ngày: hỗ trợ `hôm nay`, `hôm qua`, `hôm kia`, `ngày mai`, `N ngày trước`, `tuần trước`, `tháng này`, `tháng trước`, `DD/MM/YY`, `DD/MM/YYYY`, `DD-MM-YY`, `DD-MM-YYYY`. Backend là nguồn quyết định cuối cùng cho date parsing.
- Category inference dùng keyword tiếng Việt từ repo web nhưng phải map vào category/subcategory trong DB theo user/system category, không lưu string tự do nếu có category hợp lệ.
- Khi thiếu số tiền hoặc category không đủ tin cậy, AI phải hỏi lại hoặc trả `missingFields`; không gọi `createTransaction`.
- Với input chứa nhiều giao dịch như "được mẹ cho 500k đi chợ hết 200k", backend nên trả danh sách preview nhiều giao dịch; nếu chưa hỗ trợ bulk preview trong implementation đầu tiên, AI phải hỏi user tách từng giao dịch.
- Chat query về số dư/tổng thu/tổng chi/top category/giao dịch phải gọi backend tool trước rồi mới trả lời; không tự bịa số liệu từ prompt.
- Dữ liệu gửi sang Gemini phải tối thiểu: summary, aggregate, và sample giao dịch cần thiết có ID khi user muốn xóa; không gửi toàn bộ lịch sử giao dịch nếu không cần.
- Nếu dùng function calling native của Gemini, backend chỉ expose schema action hợp lệ; nếu dùng intent routing MVP, response vẫn phải giữ contract `toolName`, `toolResult`, `message` để sau này đổi sang native tool calling không phá frontend.

Yêu cầu receipt scan backend:

- `POST /api/v1/ai/receipt-scan` nhận `ledgerId`, `imageBase64`, `mimeType`, `currentDate?`, `timeZone?`, `preferredPaymentMethod?`; API key lấy từ server env `GEMINI_RECEIPT_API_KEY`.
- Ảnh đầu vào chỉ cho phép `image/jpeg`, `image/png`, `image/webp`; backend validate base64, decoded size, timeout, và không log nội dung ảnh.
- Prompt Gemini Vision phải yêu cầu chỉ trả JSON hợp lệ, không markdown, gồm tối thiểu: `merchantName`, `transactionDate`, `totalAmountVnd`, `description`, `categoryName`, `paymentMethod`, `items[]`, `confidence`, `rawText?`.
- Backend validate JSON bằng schema nội bộ, sau đó normalize thành `transactionPreview` theo schema app: `type`, `amountVnd`, `categoryId?`, `categoryName?`, `subcategoryId?`, `transactionDate`, `note`, `paymentMethod`, `paymentAccountId?`, `source=receipt_scan`, `missingFields`, `confidence`.
- Receipt scan chỉ tự điền form/preview, không tự tạo transaction. Lưu transaction thật vẫn đi qua `POST /api/v1/ai/execute-action` hoặc `POST /api/v1/transactions` sau khi user xác nhận.
- Receipt scan chỉ extract rồi bỏ ảnh; MVP chưa lưu ảnh và chưa sinh `receipt_image_url`.
- Receipt scan response giữ thêm payload legacy `amount`, `date`, `description`, `category` bên cạnh `transactionPreview`.
- Backend phải xử lý cả hóa đơn cửa hàng và ảnh chụp giao dịch ngân hàng/ví điện tử; merchant/beneficiary/content chuyển khoản đi vào `note` hoặc `suggestedNote`.
- Nếu không đọc được tổng tiền, ngày, hoặc category quá mơ hồ, trả preview partial với `missingFields` và `clarification`, không fallback âm thầm sang dữ liệu sai.
- Nếu receipt có nhiều line items, response giữ `items` để frontend hiển thị kiểm tra, nhưng transaction mặc định dùng `totalAmountVnd`.

Function calling backend cần hỗ trợ:

- `addTransactionPreview`
- `createTransaction`
- `getTransactionsByDateRange`
- `getBalance`
- `getTotalIncome`
- `getTotalExpense`
- `deleteTransaction`
- `deleteMultipleTransactions`
- `getBudgetStatus`
- `getTopCategories`

Hardening hiện tại:

- `POST /api/v1/ai/execute-action` validate payload theo từng action, không nhận payload tự do.
- `deleteMultipleTransactions` bắt buộc `confirmed=true`, giới hạn số lượng, không nhận ID trùng, và phải chạy atomic trong DB transaction.
- `POST /api/v1/ai/chat` phải kiểm tra ledger thuộc user trước khi gọi Gemini; nếu có `conversationId`, conversation phải thuộc cùng user và cùng ledger.
- Chat prompt được phép nạp lịch sử gần nhất theo `AI_CHAT_HISTORY_LIMIT`, nhưng phải giới hạn số message để tránh phình token.
- `POST /api/v1/ai/receipt-scan` chỉ nhận base64 hợp lệ, giới hạn kích thước ảnh, và chỉ trả structured receipt sau khi backend validate JSON/schema.
- Receipt scan phải kiểm tra `ledgerId` thuộc user trước khi map category/payment account và trả preview.
- Conversation list phải phản ánh message mới bằng cách cập nhật `ai_conversations.updated_at` khi thêm message.
- AI rate limit hiện tại dùng in-memory bucket có cleanup bucket hết hạn. Nếu chạy nhiều instance production, cần chuyển sang shared store như Redis/Postgres trước khi xem là quota/cost-control hoàn chỉnh.

Acceptance:

- Input "Ăn sáng 30" trả preview expense 30.000 VND, category Ăn uống.
- Input "lương về 15 triệu" trả preview income 15.000.000 VND, category Thu nhập.
- AI không tự lưu giao dịch nếu action yêu cầu xác nhận.
- Query "tháng này tiêu gì nhiều" phải gọi analytics/transaction query trước khi trả lời.
- System prompt inject ngày hiện tại theo `Asia/Ho_Chi_Minh`.
- Receipt scan ảnh hóa đơn cafe 45.000 VND trả `transactionPreview.amountVnd=45000`, `type=expense`, category gợi ý `Ăn uống`, note có merchant, và không tạo transaction khi chưa xác nhận.
- Receipt scan ảnh chuyển khoản ngân hàng có nội dung "ăn trưa" trả payment method `transfer`, note từ nội dung chuyển khoản, và gợi ý category `Ăn uống`.
- Gemini timeout, invalid receipt JSON, invalid receipt image, cross-ledger conversation, và bulk delete partial failure đều có test hồi quy.

### 7.11 Import/export

| Method | Path | Mục đích |
| --- | --- | --- |
| POST | `/api/v1/imports/preview` | Parse CSV/XLSX/paste text, trả valid/invalid rows |
| POST | `/api/v1/imports/:jobId/commit` | Lưu các dòng hợp lệ |
| GET | `/api/v1/exports/transactions.csv` | Export CSV |
| GET | `/api/v1/exports/transactions.xlsx` | Export Excel |
| GET | `/api/v1/exports/transactions.pdf` | Export PDF |

Acceptance:

- Import hỗ trợ ngày `dd/MM/yyyy`, `dd-MM-yyyy`, `yyyy-MM-dd`, `dd/MM/yy`, `dd-MM-yy`.
- Preview trả lỗi từng dòng.
- Commit dùng DB transaction/batch insert.
- Export có filter cùng endpoint transaction list.

### 7.12 Notifications và sync

| Method | Path | Mục đích |
| --- | --- | --- |
| POST | `/api/v1/devices` | Đăng ký Expo push token |
| DELETE | `/api/v1/devices/:id` | Tắt token |
| GET | `/api/v1/notifications` | List notification events |
| PATCH | `/api/v1/notifications/:id/read` | Mark read |
| GET | `/api/v1/sync/changes?since=timestamp` | Delta sync các bảng chính |
| POST | `/api/v1/sync/mutations` | Nhận offline mutation queue từ mobile |

Acceptance:

- Budget warning, debt due, daily reminder, goal completed tạo notification event.
- Sync trả cả record soft-deleted với `deleted_at`.
- Offline mutation có idempotency qua `client_mutation_id`.

## 8. Roadmap triển khai theo bước

### Bước 0: Chuẩn hóa nền Express

Mục tiêu: biến Express skeleton thành API service có cấu trúc module.

Tasks:

- Tách `app.js`, `server.js`, `config/db.js`, `config/env.js`.
- Bỏ phụ thuộc view Jade khỏi API path hoặc giữ chỉ cho health page nếu cần.
- Thêm `express.json` limit hợp lý, CORS cho Expo dev/prod, request id, error handler chuẩn.
- Thêm validation library như Zod hoặc Joi.
- Thêm logger có redact secrets.
- Thêm scripts: `dev`, `start`, `test`, `lint`, `migrate`, `seed`.

Acceptance:

- `GET /health` trả `{ ok: true }`.
- `GET /health/db` query Postgres thành công.
- Error không leak stack ở production.
- Có `.env.example` đầy đủ biến cần thiết.

### Bước 1: Migration và seed database

Mục tiêu: có schema PostgreSQL versioned và dữ liệu mặc định.

Tasks:

- Chọn migration tool: node-pg-migrate, Knex migrations, Drizzle, hoặc Prisma migrate.
- Tạo migration cho users, sessions, ledgers, categories, payment_accounts, transactions.
- Tạo migration cho planning, AI, import/export, notification.
- Seed system categories, subcategories, payment accounts.
- Thêm trigger cập nhật `updated_at`.
- Thêm indexes chính.

Acceptance:

- Chạy migrate từ DB trống thành công.
- Chạy seed nhiều lần không tạo trùng system data.
- Có rollback hoặc ít nhất documented recovery cho migration.

### Bước 2: Auth Google và session

Mục tiêu: mobile login được bằng Google và dùng token backend.

Tasks:

- Endpoint `POST /auth/google` verify `idToken` bằng Google client id.
- Upsert user theo `google_sub`.
- Tạo default ledger/category/payment account khi user mới.
- Phát access token TTL 3 giờ và refresh token nếu cần.
- Middleware `requireAuth`.
- Endpoint refresh/logout/me.

Acceptance:

- Login lần đầu tạo user + dữ liệu mặc định.
- Token hết hạn bị reject.
- Logout revoke refresh token.
- Test truy cập user A vào data user B bị 403/404.

### Bước 3: Ledger, category, payment account

Mục tiêu: quản lý master data trước khi giao dịch dùng tới.

Tasks:

- CRUD ledger, không cho xóa ledger cuối cùng.
- GET categories group theo type/parent.
- CRUD category custom, không xóa cứng system category.
- GET payment accounts gồm system + custom nếu có.
- Chuẩn hóa mapping từ category string legacy `Category > Subcategory`.

Acceptance:

- App lấy được danh mục 2 cấp đúng SRS.
- User tạo/sửa/xóa category custom không ảnh hưởng user khác.
- Category đang được transaction dùng chỉ soft delete, transaction vẫn giữ snapshot name.

### Bước 4: Transactions MVP

Mục tiêu: hoàn thành nghiệp vụ thu/chi cốt lõi.

Tasks:

- CRUD transaction.
- List/filter/search/pagination.
- Summary thu/chi/số dư.
- Calendar month summary.
- Bulk create có idempotency.
- Soft delete và ownership check.

Acceptance:

- TC-01 từ SRS: thêm giao dịch chi tiêu thành công, xuất hiện trong list và cập nhật số dư.
- Filter hôm nay/tuần/tháng/năm/custom chính xác theo timezone Việt Nam.
- Search note không làm chậm với 10.000 records/user.
- Không có float rounding cho tiền.

### Bước 5: Analytics và dashboard

Mục tiêu: backend trả dữ liệu biểu đồ thay vì frontend tự tổng hợp toàn bộ.

Tasks:

- Overview summary.
- Pie category breakdown.
- Daily spending bar.
- Monthly income/expense trend.
- Fluctuation chart.
- Cache nhẹ nếu cần cho range lớn.

Acceptance:

- Kết quả khớp với transaction summary.
- Query có index, không scan toàn bảng theo mọi user.
- Response shape ổn định để frontend chart dùng trực tiếp.

### Bước 6: Budgets

Mục tiêu: tạo ngân sách tháng và cảnh báo vượt ngưỡng.

Tasks:

- CRUD budgets.
- Endpoint list budget kèm actual spent/progress/status.
- Unique constraint theo user, ledger, category, month.
- Tạo notification event khi vượt 80% và 100%.

Acceptance:

- TC-03 từ SRS: vượt 100% trả status cảnh báo.
- Khi thêm/sửa/xóa transaction, budget status tính lại đúng.
- Không gửi lặp notification cùng threshold trong cùng kỳ nếu chưa reset.

### Bước 7: Goals, debts, challenges

Mục tiêu: hoàn thành nhóm Planning.

Tasks:

- Goals CRUD và deposit.
- Debts CRUD và partial payment.
- Challenges CRUD và daily check-in.
- DB transaction cho operations cập nhật số tiền còn lại/streak.
- Job đánh dấu debt overdue.

Acceptance:

- Goal đạt 100% tự chuyển completed.
- Debt payment không cho trả quá số còn lại nếu không có rule cho phép.
- Challenge check-in cùng ngày idempotent hoặc trả lỗi rõ ràng.

### Bước 8: Shopping list

Mục tiêu: hỗ trợ kế hoạch mua sắm và chuyển item thành transaction.

Tasks:

- CRUD shopping plan/item.
- Summary budget, estimated total, bought total.
- Toggle bought.
- Convert bought item to expense transaction.

Acceptance:

- Tổng dự kiến và tổng đã mua đúng.
- Convert item tạo transaction một lần duy nhất.
- Transaction được gắn source `shopping_plan`.

### Bước 9: AI chatbot và receipt scan backend

Mục tiêu: đưa AI orchestration về backend bằng Gemini keys trong environment, gồm 2 luồng chính: chatbot tài chính và quét ảnh hóa đơn/giao dịch để tự điền transaction preview.

Tasks:

- Chuẩn hóa Gemini client phía backend: server-managed keys, timeout, model config, JSON extraction, error mapping, redaction secret.
- Xây system prompt tiếng Việt dựa trên logic repo web, có current date/timezone, intent rules, category inference, missing-info rules, và yêu cầu không tự lưu transaction.
- Implement money parser: số < 1000 hiểu là nghìn, `k/nghìn/ngàn` là nghìn, `m/tr/triệu/củ` là triệu.
- Implement date parser: hôm nay, hôm qua, hôm kia, ngày mai, N ngày trước, tuần trước, tháng này, tháng trước, DD/MM/YY, DD-MM-YY.
- Map category/payment account từ output AI sang dữ liệu backend bằng category/payment account repository; giữ `missingFields` khi không map được chắc chắn.
- Function calling hoặc intent routing map vào service backend theo contract ổn định: preview, query, analytics, delete, create sau xác nhận.
- Transaction preview trước, execute sau xác nhận; receipt scan cũng chỉ trả preview để frontend tự điền form.
- Lưu conversation/message nếu user bật lịch sử, kèm tool result đã rút gọn.
- Receipt scan endpoint dùng Gemini Vision structured output, validate schema, trả `receipt` và `transactionPreview`.
- Rate limit riêng cho AI endpoints; body limit riêng cho receipt image.
- Action schemas, ledger ownership checks, chat history window, Gemini timeout, receipt image/schema validation, OpenAPI và tests.

Acceptance:

- TC-02 từ SRS: "Ăn sáng 30" tạo preview 30.000 VND, không tự lưu trước xác nhận.
- AI hỏi lại khi thiếu số tiền.
- AI query số dư/tổng chi phải lấy dữ liệu backend trước.
- Gemini key không xuất hiện trong log, DB, error response.
- Bulk delete qua AI không được xóa một phần nếu một transaction ID không hợp lệ.
- Chat history không vượt quá `AI_CHAT_HISTORY_LIMIT` và không gửi toàn bộ transaction history sang Gemini.
- Receipt scan chỉ được trả payload đã validate; raw/invalid model output phải thành lỗi chuẩn.
- Receipt scan tạo được preview hợp lệ từ hóa đơn cửa hàng và ảnh chuyển khoản ngân hàng/ví điện tử; không lưu transaction trước khi user xác nhận.

### Bước 10: Import/export

Mục tiêu: backend xử lý dữ liệu hàng loạt và file báo cáo.

Tasks:

- Preview import CSV/XLSX/paste text.
- Row-level validation.
- Commit các dòng hợp lệ vào transaction table.
- Export CSV/XLSX/PDF theo filter.
- PDF tiếng Việt phải render đúng font.

Acceptance:

- TC-06 từ SRS: export Excel đúng format và mở được.
- Import lỗi từng dòng rõ ràng.
- Commit import có transaction rollback nếu lỗi hệ thống.

### Bước 11: Notifications, reminders, background jobs

Mục tiêu: thay browser notification bằng push notification mobile.

Tasks:

- Register Expo push token.
- User notification preferences.
- Daily reminder job.
- Budget threshold job/event.
- Debt due/overdue job.
- Goal completed event.
- Store notification history.

Acceptance:

- User tắt preference thì không gửi notification loại đó.
- Job có idempotency, không spam cùng sự kiện.
- Expo push token inactive khi gửi thất bại vĩnh viễn.

### Bước 12: Sync/offline readiness

Mục tiêu: hỗ trợ mobile offline queue và delta sync.

Tasks:

- Chuẩn hóa `updated_at`, `deleted_at`, `client_mutation_id`.
- Endpoint `GET /sync/changes`.
- Endpoint `POST /sync/mutations`.
- Conflict strategy: last-write-wins cho MVP, versioning cho v2.
- Document mobile contract.

Acceptance:

- Mất mạng app vẫn queue mutation, khi online gửi lên không tạo trùng.
- Soft-deleted records được sync về client.
- Same `client_mutation_id` gọi lại trả kết quả cũ hoặc no-op.

### Bước 13: Security, reliability, observability

Mục tiêu: backend đủ an toàn để dùng với dữ liệu tài chính cá nhân.

Tasks:

- Helmet, CORS allowlist, rate limiting.
- Input validation toàn bộ endpoint.
- Ownership middleware/helpers.
- Redact secrets trong logs.
- Audit log tối thiểu cho auth, import, AI action, bulk delete.
- Centralized error codes.
- OpenAPI document.
- Basic metrics: latency, error rate, DB pool usage.

Acceptance:

- Không endpoint private nào thiếu auth.
- Không query nào thiếu `user_id`.
- Bulk delete yêu cầu xác nhận từ client/AI flow.
- Security test coverage cho cross-user access.

### Bước 14: Test, CI, deployment

Mục tiêu: có quy trình kiểm thử và deploy repeatable.

Tasks:

- Unit tests cho parser tiền/ngày/category inference.
- Integration tests cho auth, transactions, budgets, AI preview, import.
- Test DB dùng Postgres test database.
- Seed test data.
- CI chạy lint/test.
- Deploy target: Render/Railway/Fly.io/Vercel serverless hoặc Supabase Edge alternative nếu team chọn.
- Health checks và migration command documented.

Acceptance:

- Coverage tối thiểu 60% business logic theo SRS.
- Test suite chạy được bằng một command.
- Deploy có biến môi trường rõ ràng.
- Rollback plan documented.

## 9. Ưu tiên MVP

MVP backend nên hoàn thành theo thứ tự:

1. Bước 0-2: nền API, DB, auth.
2. Bước 3-4: ledger/category/payment account/transactions.
3. Bước 5-6: analytics và budgets.
4. Bước 9 phần AI chatbot: natural language -> transaction preview, query số liệu, conversation history tùy chọn.
5. Bước 9 phần receipt scan: ảnh hóa đơn/chuyển khoản -> transaction preview để frontend tự điền form.
6. Bước 10 export/import cơ bản.

Sau MVP:

- Goals, debts, challenges, shopping list.
- Push notifications.
- Offline delta sync nâng cao.

## 10. Non-functional requirements

- API response p95 dưới 300ms cho CRUD đơn giản trong điều kiện DB khỏe.
- Dashboard/summary với dưới 10.000 transactions/user trả dưới 1 giây.
- Không lưu secret người dùng như Gemini API key.
- Toàn bộ amount dùng integer VND.
- Log không chứa PII nhạy cảm quá mức; email có thể mask trong production logs.
- Tất cả ngày nghiệp vụ dùng timezone Việt Nam khi tính "hôm nay", "tháng này".
- API versioning bắt đầu từ `/api/v1`.
- Backward-compatible response contract cho mobile.

## 11. Definition of Done chung

Một bước được xem là xong khi:

- Có migration/schema nếu cần.
- Có endpoint/service tương ứng.
- Có validation input.
- Có ownership check.
- Có test unit/integration tối thiểu cho happy path và lỗi quan trọng.
- Có error response chuẩn.
- Có cập nhật OpenAPI hoặc tài liệu API.
- Chạy được lint/test liên quan.

## 12. Rủi ro và quyết định cần chốt

- Auth strategy: backend JWT tự quản hay Supabase Auth. PRD này chọn backend JWT để phù hợp Express + Google idToken từ Expo.
- Realtime: Firestore web có realtime native; Postgres backend cần REST polling, SSE/WebSocket, hoặc Supabase Realtime. MVP nên dùng REST + delta sync.
- AI API keys: backend giữ `GEMINI_CHAT_API_KEY` và `GEMINI_RECEIPT_API_KEY` trong environment, cần strict secret redaction và rotate key khi nghi ngờ lộ.
- AI model: mặc định đề xuất dùng model Gemini flash ổn định cho chat và model flash/lite có vision + structured output cho receipt scan; cần chốt model cụ thể theo quota/cost thực tế.
- Receipt image storage: MVP chỉ nhận ảnh để extract và trả preview, chưa upload/lưu ảnh. Nếu muốn lưu `receipt_image_url`, cần chốt storage provider, retention, quyền xóa và consent.
- AI chat history: MVP lưu mặc định; client có thể gửi `saveHistory=false` để tắt cho từng request.
- PDF export tiếng Việt: cần chọn thư viện/font server-side sớm để tránh lỗi font.
- Offline conflict: MVP last-write-wins, nhưng nếu app dùng offline nhiều cần version field hoặc event sourcing nhẹ.

## 13. Quyết định đã chốt cho AI

- Chatbot dùng server env `GEMINI_CHAT_API_KEY`; không nhận Gemini key từ client.
- Receipt scan dùng server env `GEMINI_RECEIPT_API_KEY`; không commit secret vào repo.
- Receipt scan chỉ extract thông tin rồi bỏ ảnh, chưa lưu ảnh hóa đơn trong MVP.
- Receipt scan response giữ cả payload legacy (`amount`, `date`, `description`, `category`) và `transactionPreview`.
- Chatbot được phép trả nhiều transaction preview trong một câu.
- Lịch sử chat lưu mặc định; client gửi `saveHistory=false` khi muốn tắt.

## 14. Checklist bàn giao cho engineer

- Đọc SRS và repo web để hiểu behavior hiện hữu.
- Hoàn thành Bước 0 trước khi viết nghiệp vụ.
- Viết migration trước API cho từng module.
- Mỗi endpoint private phải có test cross-user access.
- Mỗi parser AI phải có test bằng tiếng Việt không dấu và có dấu.
- Không đưa Gemini key vào database.
- Không dùng float cho tiền.
- Không hard delete dữ liệu nghiệp vụ trong MVP, dùng `deleted_at`.
- Luôn filter theo `ledger_id` ở transaction/planning/analytics.
