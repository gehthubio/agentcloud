import * as API from '@api';
import { loadStripe } from '@stripe/stripe-js';
import ButtonSpinner from 'components/ButtonSpinner';
import ConfirmModal from 'components/ConfirmModal';
import ErrorAlert from 'components/ErrorAlert';
import InfoAlert from 'components/InfoAlert';
import Invoice from 'components/Invoice';
import Spinner from 'components/Spinner';
import StripeCheckoutModal from 'components/StripeCheckoutModal';
import SubscriptionCard from 'components/SubscriptionCard';
import { useAccountContext } from 'context/account';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { usePostHog } from 'posthog-js/react';
import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { SubscriptionPlan, subscriptionPlans as plans } from 'struct/billing';

//DEVNOTE: see "src/lib/vectorproxy/client.ts" and "getVectorStorageForTeam", create an API route for this to get the used vector storage for this team. Once that's been retrieved use the stripe object to get the total avaiable storage and calculate the percentage
import stripe from '../lib/stripe';

const tabs = [
	{ name: 'Billing', href: '#billing' },
	{ name: 'Usage', href: '#usage' }
];

function classNames(...classes) {
	return classes.filter(Boolean).join(' ');
}

export type teamUsageData = {
	totalAvailableVectorGb: string|number;
	totalUsedVectorGb: string|number;
	totalMembers: number;
}

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
export default function Billing(props) {
	const [accountContext, refreshAccountContext]: any = useAccountContext();
	const { account, csrf } = accountContext as any;
	const { stripeCustomerId, stripePlan, stripeAddons } = account?.stripe || {};
	const [selectedPlan, setSelectedPlan] = useState(stripePlan);
	const router = useRouter();
	const [_, dispatch] = useState(props);
	const [error, setError] = useState();
	const { resourceSlug } = router.query;
	const [stagedChange, setStagedChange] = useState(null);
	const [show, setShow] = useState(false);
	const [showPaymentModal, setShowPaymentModal] = useState(false);
	const [showConfirmModal, setShowConfirmModal] = useState(false);
	const [currentTab, setCurrentTab] = useState(tabs[0]);
	const [continued, setContinued] = useState(false);
	const [last4, setLast4] = useState(null);
	//maybe refactor this into a barrier in _app or just wrapping billing pages/components
	const [missingEnvs, setMissingEnvs] = useState(null);
	const posthog = usePostHog();

	//usage information
	const [usedVectorGb, setUsedVectorGb] = useState({ //on a team level, each team has xGB of storage available (make this modular so that it can be easily interchanged with differnt api calls to the vector db proxy).
		totalAvailable: 0,
		totalUsed: 0
	});
	//all teams with corresponding user limit data
	//custom functions (code tools), on a team level

	function getPayload() {
		return {
			_csrf: csrf,
			plan: selectedPlan,
			...(stagedChange?.users ? { users: stagedChange.users } : {}),
			...(stagedChange?.storage ? { storage: stagedChange.storage } : {})
		};
	}

	function getUsageData() {

	}

	// TODO: move this to a lib (IF its useful in other files)
	const stripeMethods = [API.getPortalLink];
	function createApiCallHandler(apiMethod) {
		return async e => {
			e.preventDefault();
			const res = await apiMethod(
				{
					_csrf: getPayload()._csrf
				},
				null,
				toast.error,
				null
			);
			if (res.redirect && typeof window !== undefined) {
				const openedWindow = window.open(res.redirect, '_blank');
				openedWindow?.focus();
				if (!openedWindow) {
					//Something prevented opening new tab e.g. adblocker, or an open file selector
					window.location = res.redirect;
				}
			}
		};
	}
	const [getPortalLink] = stripeMethods.map(createApiCallHandler);

	function fetchAccount() {
		if (resourceSlug) {
			API.getAccount({ resourceSlug }, dispatch, setError, router);
		}
	}

	useEffect(() => {
		API.checkStripeReady(
			x => {
				setMissingEnvs(x.missingEnvs);
				fetchAccount();
				API.hasPaymentMethod(
					res => {
						if (res && res?.ok === true && res?.last4) {
							setLast4(res?.last4);
						}
					},
					toast.error,
					router
				);
			},
			toast.error,
			router
		);
	}, [resourceSlug]);

	useEffect(() => {
		const timeout = setTimeout(() => {
			refreshAccountContext();
		}, 500);
		return () => {
			clearTimeout(timeout);
		};
	}, [showConfirmModal]);

	useEffect(() => {
		let timeout = setTimeout(() => {
			setShow(stagedChange != null);
		}, 500);
		return () => {
			clearTimeout(timeout);
		};
	}, [stagedChange?.id]);

	if (!account || missingEnvs == null) {
		return <Spinner />;
	}

	if (missingEnvs.length > 0) {
		return (
			<ErrorAlert
				error={`Stripe functionality is missing the following:
${missingEnvs.join('\n')}`}
			/>
		);
	}

	const payload = getPayload();

	return (
		<>
			<Head>
				<title>Billing</title>
			</Head>

			{error && <ErrorAlert error={error} />}
			<nav className='-mb-px flex space-x-8' aria-label='Tabs'>
				{tabs.map(tab => (
					<a
						key={tab.name}
						href={tab.href}
						onClick={e => {
							setCurrentTab(tabs.find(t => t.name === tab.name));
						}}
						className={classNames(
							currentTab.name === tab.name
								? 'border-indigo-500 text-indigo-600'
								: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
							'whitespace-nowrap border-b-2 px-2 py-4 mb-5 text-lg font-medium flex'
						)}
						aria-current={currentTab.name === tab.name ? 'page' : undefined}
					>
						{tab.name}
					</a>
				))}
			</nav>

			{currentTab?.name === 'Billing' && (
				<>
					<div className='border-b dark:border-slate-400 mt-2 mb-4'>
						<h3 className='pl-2 font-semibold text-gray-900 dark:text-white'>
							Manage Subscription
						</h3>
					</div>
					<InfoAlert
						message='Click the button below to manage or remove payment methods, cancel your subscription, or view invoice history.'
						textColor='blue'
					/>
					<div className='flex flex-row flex-wrap gap-4 mb-6 items-center'>
						<button
							onClick={getPortalLink}
							disabled={!stripeCustomerId}
							className={
								'mt-2 transition-colors flex justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:bg-gray-600'
							}
						>
							Open Customer Portal
						</button>
					</div>
					<div className='border-b dark:border-slate-400 pb-2 my-2'>
						<h3 className='pl-2 font-semibold text-gray-900 dark:text-white'>Plan Selection</h3>
					</div>
					<div className='flex flex-row flex-wrap gap-4 py-4 items-center'>
						{plans.map(plan => (
							<SubscriptionCard
								key={plan.plan}
								title={plan.title}
								price={plan.price}
								plan={plan.plan}
								isPopular={plan.isPopular}
								link={plan.link}
								storageAddon={plan.storageAddon}
								usersAddon={plan.usersAddon}
								selectedPlan={selectedPlan}
								setSelectedPlan={setSelectedPlan}
								setStagedChange={setStagedChange}
								showConfirmModal={showConfirmModal}
								stripePlan={stripePlan}
							/>
						))}
					</div>
					<ConfirmModal
						open={showConfirmModal}
						setOpen={setShowConfirmModal}
						confirmFunction={async () => {
							const { plan, users, storage } = payload;
							const posthogBody = {
								email: account?.email,
								oldPlan: stripePlan,
								oldAddons: stripeAddons,
								newPlan: plan,
								newAddons: { users, storage }
							};
							if (stripePlan === SubscriptionPlan.FREE) {
								posthog.capture('subscribe', posthogBody);
							} else if (plan !== stripePlan) {
								posthog.capture('changePlan', posthogBody);
							}
							if (users !== stripeAddons.users || storage !== stripeAddons.storage) {
								posthog.capture('updateAddons', posthogBody);
							}

							await API.confirmChangePlan(
								payload,
								res => {
									setTimeout(() => {
										toast.success('Subscription updated successfully');
										setStagedChange(null);
										setShowConfirmModal(false);
										setShowPaymentModal(false);
										setShow(false);
									}, 500);
								},
								toast.error,
								router
							);
						}}
						cancelFunction={async () => {
							setShowConfirmModal(false);
							setShowPaymentModal(false);
							setShow(false);
							setTimeout(() => setStagedChange(null), 500);
						}}
						title='Confirm Subscription Change'
						message='Are you sure you want to change your subscription? Changes will apply immediately.'
					/>
					<StripeCheckoutModal
						showPaymentModal={showPaymentModal}
						payload={payload}
						setShow={setShowPaymentModal}
						setStagedChange={setStagedChange}
						onComplete={() => {
							setShowPaymentModal(false);
							API.hasPaymentMethod(
								res => {
									if (res && res?.ok === true && res?.last4) {
										setLast4(res?.last4);
									}
								},
								toast.error,
								router
							);
							setContinued(true);
						}}
					/>
					<Invoice
						continued={continued}
						session={stagedChange}
						show={show}
						last4={last4}
						cancelFunction={() => setShow(false)}
						confirmFunction={async () => {
							return new Promise((resolve, reject) => {
								try {
									API.hasPaymentMethod(
										res => {
											if (res && res?.ok === true) {
												setLast4(res?.last4);
												setContinued(true);
												setShowConfirmModal(true);
											} else if (payload.plan === SubscriptionPlan.FREE) {
												setContinued(true);
												setShowConfirmModal(true);
											} else {
												resolve(null);
												setShowPaymentModal(true);
											}
										},
										toast.error,
										router
									);
								} catch (e) {
									console.error(e);
									toast.success('Error updating subscription - please contact support');
									reject(e);
								}
							});
						}}
					/>
				</>
			)}


			{currentTab?.name === 'Usage' && (
				<>
					<div className='border-b dark:border-slate-400 mt-2 mb-4'>
						<h3 className='pl-2 font-semibold text-gray-900 dark:text-white'>
							View Usage
						</h3>
					</div>
					<div>

					</div>
				</>
			)}
		</>
	);
}

export async function getServerSideProps({
	req,
	res,
	query,
	resolvedUrl,
	locale,
	locales,
	defaultLocale
}) {
	return JSON.parse(JSON.stringify({ props: res?.locals?.data || {} }));
}
