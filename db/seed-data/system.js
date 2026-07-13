const systemCategories = [
  {
    type: 'expense',
    categories: [
      {
        name: 'Ăn uống',
        icon: 'utensils',
        color: '#EF4444',
        subcategories: [
          { name: 'Đi chợ/Tạp hóa' },
          { name: 'Nhà hàng' },
          { name: 'Cafe' },
          { name: 'Đồ uống' },
        ],
      },
      {
        name: 'Di chuyển',
        icon: 'car',
        color: '#F59E0B',
        subcategories: [
          { name: 'Sửa xe/Bảo dưỡng' },
          { name: 'Xăng/Dầu' },
          { name: 'Taxi/Xe công nghệ' },
          { name: 'Gửi xe' },
          { name: 'Phí cầu đường' },
        ],
      },
      {
        name: 'Mua sắm',
        icon: 'shopping-bag',
        color: '#EC4899',
        subcategories: [
          { name: 'Quần áo' },
          { name: 'Điện tử' },
          { name: 'Đồ gia dụng' },
          { name: 'Mỹ phẩm' },
        ],
      },
      {
        name: 'Hóa đơn',
        icon: 'file-text',
        color: '#6366F1',
        subcategories: [
          { name: 'Điện' },
          { name: 'Nước' },
          { name: 'Internet' },
          { name: 'Điện thoại' },
          { name: 'Bảo hiểm' },
        ],
      },
      {
        name: 'Giải trí',
        icon: 'music',
        color: '#8B5CF6',
        subcategories: [
          { name: 'Xem phim' },
          { name: 'Chơi game' },
          { name: 'Du lịch' },
          { name: 'Thể thao' },
        ],
      },
      {
        name: 'Y tế',
        icon: 'heart',
        color: '#10B981',
        subcategories: [
          { name: 'Khám bệnh' },
          { name: 'Thuốc' },
          { name: 'Bảo hiểm y tế' },
        ],
      },
      {
        name: 'Giáo dục',
        icon: 'graduation-cap',
        color: '#3B82F6',
        subcategories: [
          { name: 'Học phí' },
          { name: 'Sách vở' },
          { name: 'Khóa học' },
        ],
      },
      {
        name: 'Tiết kiệm/Đầu tư',
        icon: 'piggy-bank',
        color: '#14B8A6',
        subcategories: [
          { name: 'Tiết kiệm' },
          { name: 'Đầu tư' },
          { name: 'Chứng khoán' },
        ],
      },
      {
        name: 'Khác',
        icon: 'more-horizontal',
        color: '#64748B',
        subcategories: [],
      },
    ],
  },
  {
    type: 'income',
    categories: [
      {
        name: 'Thu nhập',
        icon: 'wallet',
        color: '#22C55E',
        subcategories: [
          { name: 'Lương' },
          { name: 'Freelance' },
          { name: 'Thưởng' },
          { name: 'Đầu tư' },
          { name: 'Trợ cấp gia đình' },
          { name: 'Sinh hoạt phí' },
          { name: 'Tiền tiêu' },
          { name: 'Tiền cho' },
        ],
      },
      {
        name: 'Khác',
        icon: 'more-horizontal',
        color: '#84CC16',
        subcategories: [],
      },
    ],
  },
];

const paymentAccounts = [
  { name: 'Tiền mặt', shortName: 'Cash', type: 'cash', color: '#64748B' },
  { name: 'Vietcombank', shortName: 'VCB', type: 'traditional_bank', color: '#0B8F45' },
  { name: 'Techcombank', shortName: 'TCB', type: 'traditional_bank', color: '#E41E2E' },
  { name: 'BIDV', shortName: 'BIDV', type: 'traditional_bank', color: '#006B68' },
  { name: 'Agribank', shortName: 'Agribank', type: 'traditional_bank', color: '#8B1E3F' },
  { name: 'MBBank', shortName: 'MB', type: 'traditional_bank', color: '#1D4ED8' },
  { name: 'VPBank', shortName: 'VPBank', type: 'traditional_bank', color: '#16A34A' },
  { name: 'ACB', shortName: 'ACB', type: 'traditional_bank', color: '#2563EB' },
  { name: 'TPBank', shortName: 'TPBank', type: 'traditional_bank', color: '#7C3AED' },
  { name: 'Sacombank', shortName: 'Sacombank', type: 'traditional_bank', color: '#1D4ED8' },
  { name: 'Timo', shortName: 'Timo', type: 'digital_bank', color: '#7C3AED' },
  { name: 'Cake by VPBank', shortName: 'Cake', type: 'digital_bank', color: '#EC4899' },
  { name: 'KBank', shortName: 'KBank', type: 'digital_bank', color: '#16A34A' },
  { name: 'TNEX', shortName: 'TNEX', type: 'digital_bank', color: '#F97316' },
  { name: 'MoMo', shortName: 'MoMo', type: 'e_wallet', color: '#A50064' },
  { name: 'ZaloPay', shortName: 'ZaloPay', type: 'e_wallet', color: '#0068FF' },
  { name: 'VNPay', shortName: 'VNPay', type: 'e_wallet', color: '#0066CC' },
  { name: 'ShopeePay', shortName: 'ShopeePay', type: 'e_wallet', color: '#EE4D2D' },
];

module.exports = {
  systemCategories,
  paymentAccounts,
};
