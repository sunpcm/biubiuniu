export interface LegacyPricingFeature {
  readonly description: string;
  readonly included: boolean;
  readonly bold?: boolean;
  readonly href?: string;
}

export interface LegacyLocalizedCopy {
  readonly cardTitle?: string;
  readonly cardDescription?: string | null;
  readonly displayPrice?: string;
  readonly originalPrice?: string;
  readonly priceSuffix?: string;
  readonly highlightText?: string;
  readonly buttonText?: string;
  readonly currency?: string;
  readonly features?: readonly LegacyPricingFeature[];
}

export interface LegacyPricingBenefits {
  readonly monthlyCredits?: number;
  readonly oneTimeCredits?: number;
  readonly totalMonths?: number;
}

export interface LegacyPricingPlan {
  readonly id: string;
  readonly environment: "test";
  readonly isActive: boolean;
  readonly groupSlug: string;
  readonly cardTitle: string;
  readonly cardDescription?: string | null;
  readonly provider: "stripe" | "creem" | "none";
  readonly stripePriceId?: string;
  readonly stripeProductId?: string;
  readonly stripeCouponId?: string;
  readonly creemProductId?: string;
  readonly creemDiscountCode?: string;
  readonly enableManualInputCoupon?: boolean;
  readonly paymentType: "recurring" | "one_time" | "onetime" | null;
  readonly recurringInterval: string | null;
  readonly price: string;
  readonly currency?: string | null;
  readonly displayPrice?: string;
  readonly originalPrice?: string;
  readonly priceSuffix?: string;
  readonly buttonText?: string;
  readonly buttonLink?: string;
  readonly highlightText?: string;
  readonly isHighlighted?: boolean;
  readonly displayOrder?: number;
  readonly features?: readonly LegacyPricingFeature[];
  readonly localized: Readonly<Record<string, LegacyLocalizedCopy>>;
  readonly benefits: LegacyPricingBenefits;
}

export const legacyPricingPlans = [
  {
    "id": "19ce176f-d89a-4838-afe7-35c951d150c2",
    "environment": "test",
    "isActive": true,
    "groupSlug": "annual",
    "cardTitle": "Annual Plan",
    "cardDescription": "[Test] Annual subscription, no credits scenario.",
    "provider": "stripe",
    "stripePriceId": "price_1RmRDIInsTsiNJR5nGIIDCXw",
    "stripeProductId": "prod_ShqvpEkgBN1Sbb",
    "stripeCouponId": "123",
    "paymentType": "recurring",
    "recurringInterval": "year",
    "price": "99",
    "currency": "USD",
    "displayPrice": "$99.00",
    "priceSuffix": "yearly",
    "buttonText": "Get Common Version",
    "buttonLink": "https://nexty.dev/#pricing",
    "isHighlighted": false,
    "displayOrder": 3,
    "features": [
      {
        "description": "All-Access Pass",
        "included": true,
        "bold": true,
        "href": ""
      },
      {
        "description": "No per-use charges or hidden fees",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Cancel anytime",
        "included": true,
        "bold": false,
        "href": ""
      }
    ],
    "localized": {
      "en": {
        "features": [
          {
            "description": "All-Access Pass",
            "included": true,
            "bold": true
          },
          {
            "description": "No per-use charges or hidden fees",
            "included": true,
            "bold": false
          },
          {
            "description": "Cancel anytime",
            "included": true,
            "bold": false
          }
        ],
        "cardTitle": "Annual Plan",
        "buttonText": "Get Common Version",
        "priceSuffix": "yearly",
        "displayPrice": "$99.00",
        "highlightText": "",
        "originalPrice": "",
        "cardDescription": "[Test] Annual subscription, no credits scenario."
      },
      "ja": {
        "features": [
          {
            "description": "すべての機能を利用可能",
            "included": true,
            "bold": true
          },
          {
            "description": "従量課金・隠れコストなし",
            "included": true,
            "bold": false
          },
          {
            "description": "いつでも解約可能",
            "included": true,
            "bold": false
          }
        ],
        "cardTitle": "年額プラン",
        "buttonText": "通常版を申し込む",
        "priceSuffix": "年",
        "displayPrice": "$99.00",
        "highlightText": "",
        "originalPrice": "",
        "cardDescription": "［テスト］年額サブスクリプション、クレジット不要。"
      },
      "zh": {
        "features": [
          {
            "description": "全功能访问权限",
            "included": true,
            "bold": true
          },
          {
            "description": "无按次收费或隐藏费用",
            "included": true,
            "bold": false
          },
          {
            "description": "随时可取消",
            "included": true,
            "bold": false
          }
        ],
        "cardTitle": "年度计划",
        "buttonText": "获取通用版",
        "priceSuffix": "每年",
        "displayPrice": "$99.00",
        "highlightText": "",
        "originalPrice": "",
        "cardDescription": "[测试] 按年订阅，无额度限制。"
      }
    },
    "benefits": {}
  },
  {
    "id": "33ba5f54-b997-48fb-ab6f-88e3bf023cac",
    "environment": "test",
    "isActive": true,
    "groupSlug": "annual",
    "cardTitle": "Annual Credits Plan",
    "cardDescription": "[Test] Annual subscription, credits scenario.",
    "provider": "stripe",
    "stripePriceId": "price_1RmRDIInsTsiNJR5sn3gyyoQ",
    "stripeProductId": "prod_ShqvpEkgBN1Sbb",
    "paymentType": "recurring",
    "recurringInterval": "year",
    "price": "199",
    "currency": "USD",
    "displayPrice": "$199.00",
    "priceSuffix": "yearly",
    "buttonText": "Get Credits Version",
    "buttonLink": "https://nexty.dev/#pricing",
    "highlightText": "Best Value",
    "isHighlighted": true,
    "displayOrder": 4,
    "features": [
      {
        "description": "1000 credits per month",
        "included": true,
        "bold": true,
        "href": ""
      },
      {
        "description": "Full access at no extra cost",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Cancel or upgrade anytime",
        "included": true,
        "bold": false,
        "href": ""
      }
    ],
    "localized": {
      "en": {
        "features": [
          {
            "description": "1000 credits per month",
            "included": true,
            "bold": true
          },
          {
            "description": "Full access at no extra cost",
            "included": true,
            "bold": false
          },
          {
            "description": "Cancel or upgrade anytime",
            "included": true,
            "bold": false
          }
        ],
        "cardTitle": "Annual Credits Plan",
        "buttonText": "Get Credits Version",
        "priceSuffix": "yearly",
        "displayPrice": "$199.00",
        "highlightText": "Best Value",
        "originalPrice": "",
        "cardDescription": "[Test] Annual subscription, credits scenario."
      },
      "ja": {
        "features": [
          {
            "description": "毎月1,000クレジット",
            "included": true,
            "bold": true
          },
          {
            "description": "追加料金なしで全機能利用",
            "included": true,
            "bold": false
          },
          {
            "description": "いつでも解約・アップグレード可能",
            "included": true,
            "bold": false
          }
        ],
        "cardTitle": "年間クレジットプラン",
        "buttonText": "クレジット版を申し込む",
        "priceSuffix": "年",
        "displayPrice": "$199.00",
        "highlightText": "最もお得",
        "originalPrice": "",
        "cardDescription": "［テスト］年額サブスクリプション、クレジット付与プラン。"
      },
      "zh": {
        "features": [
          {
            "description": "每月 1000 额度",
            "included": true,
            "bold": true
          },
          {
            "description": "全功能访问，无额外费用",
            "included": true,
            "bold": false
          },
          {
            "description": "随时取消或升级",
            "included": true,
            "bold": false
          }
        ],
        "cardTitle": "年度额度计划",
        "buttonText": "获取额度版",
        "priceSuffix": "每年",
        "displayPrice": "$199.00",
        "highlightText": "性价比最高",
        "originalPrice": "",
        "cardDescription": "[测试] 按年订阅，额度方案。"
      }
    },
    "benefits": {
      "totalMonths": 12,
      "monthlyCredits": 1000
    }
  },
  {
    "id": "0f9c8e3b-db74-4de8-bbb4-672dd1a3ff7e",
    "environment": "test",
    "isActive": true,
    "groupSlug": "monthly",
    "cardTitle": "Monthly Plan",
    "cardDescription": null,
    "provider": "stripe",
    "stripePriceId": "price_1REnJGInsTsiNJR5m3YTCh0b",
    "stripeProductId": "prod_S95UdH9Cq5abtk",
    "paymentType": "recurring",
    "recurringInterval": "month",
    "price": "9.9",
    "currency": "USD",
    "displayPrice": "$9.90",
    "priceSuffix": "month",
    "buttonText": "Get Stripe Version",
    "highlightText": "Stripe Plan",
    "isHighlighted": true,
    "displayOrder": 3,
    "features": [
      {
        "description": "All-Access Pass",
        "included": true,
        "bold": true,
        "href": ""
      },
      {
        "description": "No per-use charges or hidden fees",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Cancel anytime",
        "included": true,
        "bold": false,
        "href": ""
      }
    ],
    "localized": {
      "en": {
        "currency": "usd",
        "features": [
          {
            "description": "All-Access Pass",
            "included": true,
            "bold": true,
            "href": ""
          },
          {
            "description": "No per-use charges or hidden fees",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Cancel anytime",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "Monthly Plan",
        "buttonText": "Get Stripe Version",
        "priceSuffix": "month",
        "displayPrice": "$9.90",
        "highlightText": "Stripe Plan",
        "originalPrice": "",
        "cardDescription": ""
      },
      "ja": {
        "currency": "usd",
        "features": [
          {
            "description": "全アクセスパス",
            "included": true,
            "bold": true,
            "href": ""
          },
          {
            "description": "使用料や隠れた手数料はなし",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "いつでもキャンセル可能",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "月額プラン",
        "buttonText": "Stripeバージョンを取得",
        "priceSuffix": "月",
        "displayPrice": "$9.90",
        "highlightText": "Stripeプラン",
        "originalPrice": "",
        "cardDescription": ""
      },
      "zh": {
        "currency": "usd",
        "features": [
          {
            "description": "全部功能的权限",
            "included": true,
            "bold": true,
            "href": ""
          },
          {
            "description": "没有按使用收费或隐藏费用",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "随时取消",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "月度计划",
        "buttonText": "获取Stripe版本",
        "priceSuffix": "每月",
        "displayPrice": "$9.90",
        "highlightText": "Stripe计划",
        "originalPrice": "",
        "cardDescription": ""
      }
    },
    "benefits": {
      "monthlyCredits": 500
    }
  },
  {
    "id": "caa8be4e-dcb2-405a-8ec9-da8e12e93912",
    "environment": "test",
    "isActive": true,
    "groupSlug": "monthly",
    "cardTitle": "Monthly Plan",
    "cardDescription": null,
    "provider": "creem",
    "creemProductId": "prod_41izeM5t7E6V5NgodCVOWM",
    "creemDiscountCode": "BF2025",
    "paymentType": "recurring",
    "recurringInterval": "every-month",
    "price": "19",
    "currency": "USD",
    "displayPrice": "$19.00",
    "priceSuffix": "month",
    "buttonText": "Get Creem Version",
    "highlightText": "Creem Plan",
    "isHighlighted": false,
    "displayOrder": 3,
    "features": [
      {
        "description": "All-Access Pass",
        "included": true,
        "bold": true,
        "href": ""
      },
      {
        "description": "No per-use charges or hidden fees",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Cancel anytime",
        "included": true,
        "bold": false,
        "href": ""
      }
    ],
    "localized": {
      "en": {
        "currency": "USD",
        "features": [
          {
            "description": "All-Access Pass",
            "included": true,
            "bold": true,
            "href": ""
          },
          {
            "description": "No per-use charges or hidden fees",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Cancel anytime",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "Monthly Plan",
        "buttonText": "Get Creem Version",
        "priceSuffix": "month",
        "displayPrice": "$19.00",
        "highlightText": "Creem Plan",
        "originalPrice": "",
        "cardDescription": ""
      },
      "ja": {
        "currency": "USD",
        "features": [
          {
            "description": "全アクセスパス",
            "included": true,
            "bold": true,
            "href": ""
          },
          {
            "description": "使用料や隠れた手数料はなし",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "いつでもキャンセル可能",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "月額プラン",
        "buttonText": "Creemバージョンを取得",
        "priceSuffix": "月",
        "displayPrice": "$19.00",
        "highlightText": "Creemプラン",
        "originalPrice": "",
        "cardDescription": ""
      },
      "zh": {
        "currency": "USD",
        "features": [
          {
            "description": "全访问通行证",
            "included": true,
            "bold": true,
            "href": ""
          },
          {
            "description": "没有按使用收费或隐藏费用",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "随时取消",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "月度计划",
        "buttonText": "获取Creem版本",
        "priceSuffix": "月",
        "displayPrice": "$19.00",
        "highlightText": "Creem计划",
        "originalPrice": "",
        "cardDescription": ""
      }
    },
    "benefits": {
      "monthlyCredits": 500
    }
  },
  {
    "id": "df9be754-0f09-4289-9ef6-25323353dce0",
    "environment": "test",
    "isActive": true,
    "groupSlug": "no-payment",
    "cardTitle": "Internal Link",
    "cardDescription": "Next.js SaaS starter template for developers and product managers.",
    "provider": "none",
    "paymentType": null,
    "recurringInterval": null,
    "price": "0",
    "currency": null,
    "displayPrice": "$128.00",
    "originalPrice": "$256.00",
    "priceSuffix": "/lifetime",
    "buttonText": "Get Pro Version",
    "buttonLink": "/blog",
    "highlightText": "Best Value",
    "isHighlighted": false,
    "displayOrder": 5,
    "features": [
      {
        "description": "Analytics & Ads",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Email Newsletter",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Internationalization",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Database",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Dynamic Blog(CMS)",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Static Blog",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Authentication",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Payment",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "AI",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "File Storage",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Admin Dashboard",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Lifetime license",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "24/7 Email Support",
        "included": true,
        "bold": false,
        "href": ""
      }
    ],
    "localized": {
      "en": {
        "currency": "usd",
        "features": [
          {
            "description": "Analytics & Ads",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Email Newsletter",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Internationalization",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Database",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Dynamic Blog(CMS)",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Static Blog",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Authentication",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Payment",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "AI",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "File Storage",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Admin Dashboard",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Lifetime license",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "24/7 Email Support",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "Internal Link",
        "buttonText": "Get Pro Version",
        "priceSuffix": "/lifetime",
        "displayPrice": "$128.00",
        "highlightText": "Best Value",
        "originalPrice": "$256.00",
        "cardDescription": "Next.js SaaS starter template for developers and product managers."
      },
      "ja": {
        "currency": "usd",
        "features": [
          {
            "description": "分析と広告",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "メールニュースレター",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "国際化",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "データベース",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "ダイナミックブログ（CMS）",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "スタティックブログ",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "認証",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "支払い",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "AI",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "ファイルストレージ",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "管理者ダッシュボード",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "生涯ライセンス",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "24/7 メールサポート",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "内部リンク",
        "buttonText": "プロ版を取得",
        "priceSuffix": "/生涯",
        "displayPrice": "$128.00",
        "highlightText": "最高の価値",
        "originalPrice": "$256.00",
        "cardDescription": "開発者とプロダクトマネージャーのための Next.js SaaS スターターテンプレート。"
      },
      "zh": {
        "currency": "usd",
        "features": [
          {
            "description": "分析与广告",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "电子邮件通讯",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "国际化",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "数据库",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "动态博客（CMS）",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "静态博客",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "身份验证",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "支付",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "人工智能",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "文件存储",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "管理员仪表板",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "终身许可证",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "24/7 电子邮件支持",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "内部链接",
        "buttonText": "获取专业版",
        "priceSuffix": "/终身",
        "displayPrice": "$128.00",
        "highlightText": "最佳价值",
        "originalPrice": "$256.00",
        "cardDescription": "适用于开发人员和产品经理的 Next.js SaaS 启动模板。"
      }
    },
    "benefits": {
      "oneTimeCredits": 1000
    }
  },
  {
    "id": "f1b4be4e-24f1-458c-b161-8dd47761a103",
    "environment": "test",
    "isActive": true,
    "groupSlug": "onetime",
    "cardTitle": "Pro - No Credits",
    "cardDescription": "Next.js SaaS starter template for developers and product managers.",
    "provider": "stripe",
    "stripePriceId": "price_1RmRDIInsTsiNJR5RBtb7egL",
    "stripeProductId": "prod_ShqvpEkgBN1Sbb",
    "stripeCouponId": "BKTLnjeF",
    "enableManualInputCoupon": true,
    "paymentType": "one_time",
    "recurringInterval": null,
    "price": "256",
    "currency": "USD",
    "displayPrice": "$128.00",
    "originalPrice": "$256.00",
    "priceSuffix": "/lifetime",
    "buttonText": "Get Pro Version",
    "highlightText": "Best Value",
    "isHighlighted": false,
    "displayOrder": 5,
    "features": [
      {
        "description": "Internationalization",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Email Newsletter",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Analytics & Ads",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Database",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Static Blog",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Dynamic Blog(CMS)",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Authentication",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Payment",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "AI",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "File Storage",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Admin Dashboard",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Lifetime license",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "24/7 Email Support",
        "included": true,
        "bold": false,
        "href": ""
      }
    ],
    "localized": {
      "en": {
        "features": [
          {
            "description": "Internationalization",
            "included": true
          },
          {
            "description": "Email Newsletter",
            "included": true
          },
          {
            "description": "Analytics & Ads",
            "included": true
          },
          {
            "description": "Database",
            "included": true
          },
          {
            "description": "Static Blog",
            "included": true
          },
          {
            "description": "Dynamic Blog(CMS)",
            "included": true
          },
          {
            "description": "Authentication",
            "included": true
          },
          {
            "description": "Payment",
            "included": true
          },
          {
            "description": "AI",
            "included": true
          },
          {
            "description": "File Storage",
            "included": true
          },
          {
            "description": "Admin Dashboard",
            "included": true
          },
          {
            "description": "Lifetime license",
            "included": true
          },
          {
            "description": "24/7 Email Support",
            "included": true
          }
        ],
        "cardTitle": "Pro",
        "buttonText": "Get Pro Version",
        "priceSuffix": "/lifetime",
        "displayPrice": "$256.00",
        "highlightText": "Best Value",
        "cardDescription": "Next.js SaaS starter template for developers and product managers."
      },
      "ja": {
        "features": [
          {
            "description": "国際化対応",
            "included": true
          },
          {
            "description": "メールニュースレター",
            "included": true
          },
          {
            "description": "分析＆広告",
            "included": true
          },
          {
            "description": "データベース",
            "included": true
          },
          {
            "description": "静的ブログ",
            "included": true
          },
          {
            "description": "動的ブログ(CMS)",
            "included": true
          },
          {
            "description": "認証機能",
            "included": true
          },
          {
            "description": "決済機能",
            "included": true
          },
          {
            "description": "AI",
            "included": true
          },
          {
            "description": "ファイルストレージ",
            "included": true
          },
          {
            "description": "管理ダッシュボード",
            "included": true
          },
          {
            "description": "永久ライセンス",
            "included": true
          },
          {
            "description": "24時間年中無休のメールサポート",
            "included": true
          }
        ],
        "cardTitle": "プロ版",
        "buttonText": "プロ版を入手",
        "priceSuffix": "/永久",
        "displayPrice": "$256.00",
        "highlightText": "最高の価値",
        "cardDescription": "開発者やプロダクトマネージャー向けのNext.js SaaSスターターテンプレート。"
      },
      "zh": {
        "features": [
          {
            "description": "国际化支持",
            "included": true
          },
          {
            "description": "电子邮件通讯",
            "included": true
          },
          {
            "description": "分析与广告",
            "included": true
          },
          {
            "description": "数据库",
            "included": true
          },
          {
            "description": "静态博客",
            "included": true
          },
          {
            "description": "动态博客(CMS)",
            "included": true
          },
          {
            "description": "身份验证",
            "included": true
          },
          {
            "description": "支付功能",
            "included": true
          },
          {
            "description": "人工智能",
            "included": true
          },
          {
            "description": "文件存储",
            "included": true
          },
          {
            "description": "管理仪表板",
            "included": true
          },
          {
            "description": "终身许可证",
            "included": true
          },
          {
            "description": "24/7 电子邮件支持",
            "included": true
          }
        ],
        "cardTitle": "专业版",
        "buttonText": "获取专业版",
        "priceSuffix": "/终身",
        "displayPrice": "$256.00",
        "highlightText": "最佳价值",
        "cardDescription": "为开发者和产品经理打造的Next.js SaaS起步模板。"
      }
    },
    "benefits": {}
  },
  {
    "id": "be8acdef-46d3-4c0b-8c20-58a86a4a8b6f",
    "environment": "test",
    "isActive": true,
    "groupSlug": "onetime",
    "cardTitle": "Pro - creem",
    "cardDescription": "Next.js SaaS starter template for developers and product managers.",
    "provider": "creem",
    "creemProductId": "prod_6JLiUBr0GKYQxqtHQ8TF8A",
    "creemDiscountCode": "NEW",
    "paymentType": "onetime",
    "recurringInterval": "once",
    "price": "256",
    "currency": "USD",
    "displayPrice": "$256.00",
    "priceSuffix": "/lifetime",
    "buttonText": "Get Pro Version",
    "highlightText": "Best Value",
    "isHighlighted": true,
    "displayOrder": 6,
    "features": [
      {
        "description": "Internationalization",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Email Newsletter",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Analytics & Ads",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Database",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Static Blog",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Dynamic Blog(CMS)",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Authentication",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Payment",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "AI",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "File Storage",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Admin Dashboard",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "Lifetime license",
        "included": true,
        "bold": false,
        "href": ""
      },
      {
        "description": "24/7 Email Support",
        "included": true,
        "bold": false,
        "href": ""
      }
    ],
    "localized": {
      "en": {
        "currency": "USD",
        "features": [
          {
            "description": "Internationalization",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Email Newsletter",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Analytics & Ads",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Database",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Static Blog",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Dynamic Blog(CMS)",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Authentication",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Payment",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "AI",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "File Storage",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Admin Dashboard",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "Lifetime license",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "24/7 Email Support",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "Pro - creem",
        "buttonText": "Get Pro Version",
        "priceSuffix": "/lifetime",
        "displayPrice": "$256.00",
        "highlightText": "Best Value",
        "originalPrice": "",
        "cardDescription": "Next.js SaaS starter template for developers and product managers."
      },
      "ja": {
        "currency": "USD",
        "features": [
          {
            "description": "国際化",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "メールニュースレター",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "分析と広告",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "データベース",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "静的ブログ",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "動的ブログ（CMS）",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "認証",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "支払い",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "AI",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "ファイルストレージ",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "管理者ダッシュボード",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "生涯ライセンス",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "24/7 メールサポート",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "プロ - creem",
        "buttonText": "プロ版を取得",
        "priceSuffix": "/生涯",
        "displayPrice": "$256.00",
        "highlightText": "最高の価値",
        "originalPrice": "",
        "cardDescription": "開発者とプロダクトマネージャーのための Next.js SaaS スターターテンプレート。"
      },
      "zh": {
        "currency": "USD",
        "features": [
          {
            "description": "国际化",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "电子邮件通讯",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "分析与广告",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "数据库",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "静态博客",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "动态博客（CMS）",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "身份验证",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "支付",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "人工智能",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "文件存储",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "管理员仪表板",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "终身许可证",
            "included": true,
            "bold": false,
            "href": ""
          },
          {
            "description": "24/7 电子邮件支持",
            "included": true,
            "bold": false,
            "href": ""
          }
        ],
        "cardTitle": "专业版 - creem",
        "buttonText": "获取专业版",
        "priceSuffix": "/终身",
        "displayPrice": "$256.00",
        "highlightText": "最佳价值",
        "originalPrice": "",
        "cardDescription": "适用于开发者和产品经理的 Next.js SaaS 启动模板。"
      }
    },
    "benefits": {
      "oneTimeCredits": 500
    }
  }
] as const satisfies readonly LegacyPricingPlan[];

export const legacyPricingSourceSha256 = '937fbb53a8ae260574ac75f10796a23744330fe56a585c45185e0b0169e430e6' as const;

export const legacyPricingPlanIds: readonly string[] = legacyPricingPlans.map(
  (plan) => plan.id,
);

export function getLegacyPricingPlanById(id: string): LegacyPricingPlan | undefined {
  return legacyPricingPlans.find((plan) => plan.id === id);
}

export function getLegacyPricingCopy(
  plan: LegacyPricingPlan,
  locale: string,
): LegacyLocalizedCopy {
  return plan.localized[locale] ?? plan.localized.en ?? {};
}

export function getLegacyProviderRef(
  plan: LegacyPricingPlan,
): string | undefined {
  return plan.provider === "stripe"
    ? plan.stripePriceId
    : plan.provider === "creem"
      ? plan.creemProductId
      : undefined;
}

export const legacyPricingLimitations = [
  "All seven source plans are environment=test; none is a live price reference.",
  "stripeCouponId and creemDiscountCode are source discount references, not customer-facing promotion codes.",
  "provider=none is a display-only internal link and cannot enter a payment-provider enum.",
  "totalMonths=12 preserves a historical annual benefit; the current subscription reset rules are unchanged.",
  "This static export does not run the source seed, call a provider API, or migrate real business data.",
] as const;
