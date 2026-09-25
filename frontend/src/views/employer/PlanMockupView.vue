<script setup lang="ts">
/**
 * PlanMockupView — static mockup của Upgrade Plan page (Fixoria Studio).
 *
 * Layout: main content only (title + Monthly/Annual toggle + 3 plan cards).
 * Mockup only — không call API.
 */
import { ref } from 'vue'
import { Star, Check } from 'lucide-vue-next'

// ===== Pricing toggle =====
type BillingCycle = 'monthly' | 'annual'
const billing = ref<BillingCycle>('annual')

// ===== Plan cards =====
interface PlanFeature {
  text: string
}
interface Plan {
  name: string
  badge?: string
  price: string
  pricePrefix?: string
  priceSuffix?: string
  description: string
  features: PlanFeature[]
  ctaLabel: string
  ctaVariant: 'disabled' | 'outline' | 'solid'
  trialText: string
  highlighted?: boolean
}

const plans: Plan[] = [
  {
    name: 'Creator',
    price: '$19',
    priceSuffix: 'Per user, & per month',
    description:
      'Unlock powerful AI tools to create your content, wherever you work online.',
    features: [
      { text: 'UI User Access' },
      { text: 'Access to Fixora AI Chatbot' },
      { text: 'Access to SEO Mode' },
      { text: 'AI Image Generation and editing Tool' },
      { text: 'Q8 Brand Voice Access' },
      { text: 'Use AI with Browser Extension' },
    ],
    ctaLabel: 'Current Plan',
    ctaVariant: 'disabled',
    trialText: 'Start Free 7-Days Trial',
  },
  {
    name: 'Pro Plan',
    badge: 'Popular',
    price: '$99',
    priceSuffix: 'Per user, per month *Billed annually',
    description:
      'Leverage advanced AI to create content. For multiple brands on campaigns.',
    features: [
      { text: '05 User Access' },
      { text: '10 Knowledge Assets' },
      { text: 'Access to Pro SEO Mode' },
      { text: 'Collaboration with our Management' },
      { text: '10 Brand Voice Access' },
      { text: '01 Page Custom change Access' },
    ],
    ctaLabel: 'Switch to this Plan',
    ctaVariant: 'outline',
    trialText: 'Start Free 7-Days Trial',
    highlighted: true,
  },
  {
    name: 'Business Plan',
    price: '$199',
    pricePrefix: 'Start from',
    priceSuffix: 'Custom Pricing, Custom Billing',
    description:
      'Personalized AI with enhanced control, security, team training, and tech support.',
    features: [
      { text: 'Unlimited Feature Usage' },
      { text: 'Performance Analytics & insights' },
      { text: 'Custom Style Guides with New View' },
      { text: 'Advanced Admin Panel Access' },
      { text: 'Group Document Collaboration' },
      { text: 'Hight Security Platform' },
    ],
    ctaLabel: 'Contact Sales',
    ctaVariant: 'solid',
    trialText: 'Start Free 15-Days Trial',
  },
]
</script>

<template>
      <!-- ============== MAIN CONTENT ============== -->
      <main class="min-w-0 flex-1 bg-slate-50/50 px-6 py-10">
        <div class="mx-auto max-w-[1100px]">
          <!-- Heading -->
          <h1 class="text-3xl font-bold text-slate-900">
            Upgrade Plan
          </h1>

          <p class="mt-2 text-sm text-slate-500">
            Fixoria pricing plan are designed to meet your needs as you grow
          </p>

          <!-- Billing toggle -->
          <div class="mt-6 inline-flex rounded-xl border border-slate-200 bg-white p-1">
            <button
              @click="billing = 'monthly'"
              class="rounded-lg px-5 py-2 text-sm font-medium transition"
              :class="
                billing === 'monthly'
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-500 hover:text-slate-700'
              "
            >
              Monthly
            </button>

            <button
              @click="billing = 'annual'"
              class="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition"
              :class="
                billing === 'annual'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              "
            >
              Annual (Save 50%)
            </button>
          </div>

          <!-- Plan cards -->
          <div class="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
            <article
              v-for="plan in plans"
              :key="plan.name"
              class="relative flex flex-col rounded-2xl border bg-white p-6 transition"
              :class="
                plan.highlighted
                  ? 'border-purple-500 shadow-lg shadow-purple-100'
                  : 'border-slate-200'
              "
            >
              <!-- Badge -->
              <span
                v-if="plan.badge"
                class="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700"
              >
                <Star :size="12" class="fill-purple-600 text-purple-600" />

                {{ plan.badge }}
              </span>

              <!-- Header -->
              <h3 class="text-xl font-semibold text-slate-900">
                {{ plan.name }}
              </h3>

              <p class="mt-2 text-sm leading-relaxed text-slate-500">
                {{ plan.description }}
              </p>

              <!-- Price -->
              <div class="mt-5">
                <div v-if="plan.pricePrefix" class="text-xs text-slate-500">
                  {{ plan.pricePrefix }}
                </div>

                <div class="flex items-baseline gap-1">
                  <span class="text-3xl font-bold text-slate-900">
                    {{ plan.price }}
                  </span>
                </div>

                <p v-if="plan.priceSuffix" class="mt-1 text-xs text-slate-500">
                  {{ plan.priceSuffix }}
                </p>
              </div>

              <!-- CTA -->
              <button
                class="mt-5 w-full rounded-lg py-2.5 text-sm font-medium transition disabled:cursor-default"
                :class="
                  plan.ctaVariant === 'solid'
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : plan.ctaVariant === 'outline'
                      ? 'border border-purple-500 text-purple-700 hover:bg-purple-50'
                      : 'bg-slate-100 text-slate-400'
                "
                :disabled="plan.ctaVariant === 'disabled'"
              >
                {{ plan.ctaLabel }}
              </button>

              <p class="mt-3 text-center text-xs">
                <span class="text-slate-500">Start </span>

                <span class="font-semibold text-purple-600">
                  {{ plan.trialText.replace('Start ', '').split(' ')[0] }}
                  {{ plan.trialText.replace('Start ', '').split(' ').slice(1).join(' ') }}
                </span>
              </p>

              <hr class="my-5 border-slate-200" />

              <!-- Features -->
              <div class="flex-1">
                <h4 class="text-sm font-semibold text-slate-900">
                  Features
                </h4>

                <p class="mt-1 text-xs text-slate-500">
                  {{
                    plan.name === 'Creator'
                      ? 'Everything in our free plan includes'
                      : plan.name === 'Pro Plan'
                        ? 'Everything in Creator & Plus'
                        : 'Everything in Creator, Plus & Business'
                  }}
                </p>

                <ul class="mt-4 space-y-2.5">
                  <li
                    v-for="feature in plan.features"
                    :key="feature.text"
                    class="flex items-center gap-2.5 text-sm text-slate-700"
                  >
                    <span
                      class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-100"
                    >
                      <Check :size="11" class="text-purple-600" :stroke-width="3" />
                    </span>

                    <span>{{ feature.text }}</span>
                  </li>
                </ul>
              </div>
            </article>
          </div>
        </div>
      </main>
</template>
