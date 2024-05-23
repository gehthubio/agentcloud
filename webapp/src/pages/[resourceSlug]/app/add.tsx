import * as API from '@api';
import { ChatBubbleLeftIcon, CogIcon } from '@heroicons/react/24/outline';
import AppForm from 'components/AppForm';
import SimpleAppForm from 'components/SimpleAppForm';
import Spinner from 'components/Spinner';
import { useAccountContext } from 'context/account';
import { useStepContext } from 'context/stepwrapper';
import Head from 'next/head';
import { useRouter } from 'next/router';
import React, { useEffect, useState } from 'react';

export default function AddApp(props) {
	const [accountContext]: any = useAccountContext();
	const { account, csrf, teamName } = accountContext as any;
	const router = useRouter();
	const { resourceSlug } = router.query;
	const [state, dispatch] = useState(props);
	const [error, setError] = useState();
	const { step, setStep }: any = useStepContext();
	const { apps, tools, agents, tasks, models, datasources } = state;

	async function fetchAppFormData() {
		await API.getApps({ resourceSlug }, dispatch, setError, router);
	}

	useEffect(() => {
		fetchAppFormData();
	}, [resourceSlug]);

	if (apps == null) {
		return <Spinner />;
	}

	const renderStepContent = () => {
		switch (step) {
			case 0:
				return (
					<div className='p-4'>
						<h2 className='text-2xl font-bold text-center mb-6'>
							What type of app would you like to make?
						</h2>
						<div className='grid grid-cols-2 gap-4'>
							<div
								className='p-6 bg-white shadow-lg hover:shadow-xl transition-shadow duration-300 cursor-pointer rounded-lg text-center'
								onClick={() => setStep(1)}
							>
								<ChatBubbleLeftIcon className='h-16 w-16 mx-auto text-blue-500' />
								<h3 className='mt-4 text-xl font-semibold text-gray-700'>Chat</h3>
							</div>
							<div
								className='p-6 bg-white shadow-lg hover:shadow-xl transition-shadow duration-300 cursor-pointer rounded-lg text-center'
								onClick={() => setStep(2)}
							>
								<CogIcon className='h-16 w-16 mx-auto text-green-500' />
								<h3 className='mt-4 text-xl font-semibold text-gray-700'>Custom</h3>
							</div>
						</div>
						<button
							className='mt-6 bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded inline-flex items-center'
							onClick={() => router.push(`/${resourceSlug}/apps`)}
						>
							<svg className='h-4 w-4 mr-2' fill='none' stroke='currentColor' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
								<path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M15 19l-7-7 7-7'></path>
							</svg>
							<span>Back</span>
						</button>
					</div>
				);
			case 1:
				return (
					<SimpleAppForm
						datasourceChoices={datasources}
						fetchFormData={fetchAppFormData}
					/>
				);
			case 2:
				return (
					<AppForm
						agentChoices={agents}
						taskChoices={tasks}
						// toolChoices={tools}
						modelChoices={models}
						fetchFormData={fetchAppFormData}
					/>
				);
			default:
				return null;
		}
	};

	return (<>
		<Head>
			<title>{`New App - ${teamName}`}</title>
		</Head>
		{renderStepContent()}
	</>);
}

export async function getServerSideProps({ req, res, query, resolvedUrl, locale, locales, defaultLocale }) {
	return JSON.parse(JSON.stringify({ props: res?.locals?.data || {} }));
}
